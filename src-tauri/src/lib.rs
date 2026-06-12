use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use skilens_core::{
    discover_skills, scan_claude_logs, scan_claude_session_meta, scan_claude_telemetry, summarize,
    write_legacy_outputs, ScanOptions, SummaryPayload,
};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

type DbPool = Pool<SqliteConnectionManager>;

#[derive(Clone)]
struct AppState {
    db: DbPool,
    data_dir: PathBuf,
    scan_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ArchivePayload {
    skills: Vec<String>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SkillMdFile {
    path: String,
    content: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SkillMdPayload {
    name: String,
    files: Vec<SkillMdFile>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeletePayload {
    moved: Vec<MoveEntry>,
    archive: ArchivePayload,
    warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RevealPayload {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MoveEntry {
    from: String,
    to: String,
}

#[tauri::command]
fn get_dashboard_data(state: State<AppState>) -> Result<SummaryPayload, String> {
    load_latest_payload(&state.data_dir).or_else(|_| rescan_inner(&state))
}

#[tauri::command]
fn rescan(state: State<AppState>) -> Result<SummaryPayload, String> {
    rescan_inner(&state)
}

#[tauri::command]
fn get_archives(state: State<AppState>) -> Result<ArchivePayload, String> {
    load_archives(&state.db)
}

#[tauri::command]
fn archive_skill(state: State<AppState>, name: String) -> Result<ArchivePayload, String> {
    archive_skill_names(&state.db, &[name])
}

#[tauri::command]
fn archive_skills(state: State<AppState>, names: Vec<String>) -> Result<ArchivePayload, String> {
    archive_skill_names(&state.db, &names)
}

#[tauri::command]
fn delete_skill(state: State<AppState>, name: String) -> Result<DeletePayload, String> {
    let payload = load_latest_payload(&state.data_dir).ok();
    let Some(skill) = payload
        .as_ref()
        .and_then(|payload| payload.skills.iter().find(|skill| skill.name == name))
    else {
        let archive = archive_skill_names(&state.db, std::slice::from_ref(&name))?;
        return Ok(DeletePayload {
            moved: Vec::new(),
            archive,
            warning: Some("skill not found; archived only".to_string()),
        });
    };

    let paths = skill
        .sources
        .iter()
        .map(|source| PathBuf::from(&source.path))
        .filter(|path| is_allowed_skill_md_path(path))
        .collect::<Vec<_>>();
    let moved = move_skill_paths_to_trash(&name, &paths)?;
    let archive = match archive_skill_names(&state.db, std::slice::from_ref(&name)) {
        Ok(archive) => archive,
        Err(error) => {
            rollback_moves(&moved);
            return Err(error);
        }
    };
    Ok(DeletePayload {
        moved,
        archive,
        warning: None,
    })
}

#[tauri::command]
fn read_skill_md(state: State<AppState>, name: String) -> Result<SkillMdPayload, String> {
    let payload = load_latest_payload(&state.data_dir)?;
    let Some(skill) = payload.skills.iter().find(|skill| skill.name == name) else {
        return Err("skill not found".to_string());
    };
    let mut files = Vec::new();
    for source in &skill.sources {
        let path = PathBuf::from(&source.path);
        if !is_allowed_skill_md_path(&path) {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(content) => files.push(SkillMdFile {
                path: source.path.clone(),
                content: Some(content.chars().take(200_000).collect()),
                error: None,
            }),
            Err(error) => files.push(SkillMdFile {
                path: source.path.clone(),
                content: None,
                error: Some(error.to_string()),
            }),
        }
    }
    if files.is_empty() {
        return Err("no SKILL.md source on disk".to_string());
    }
    Ok(SkillMdPayload { name, files })
}

#[tauri::command]
fn reveal_skill_md(state: State<AppState>, name: String) -> Result<RevealPayload, String> {
    let payload = load_latest_payload(&state.data_dir)?;
    let Some(skill) = payload.skills.iter().find(|skill| skill.name == name) else {
        return Err("skill not found".to_string());
    };
    let Some(path) = skill
        .sources
        .iter()
        .map(|source| PathBuf::from(&source.path))
        .find(|path| is_allowed_skill_md_path(path))
    else {
        return Err("no SKILL.md source on disk".to_string());
    };

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("Finder failed to reveal SKILL.md".to_string());
        }
    }

    Ok(RevealPayload {
        path: path.to_string_lossy().to_string(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                dirs::data_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("skills-stats")
            });
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("skills-stats.db");
            let manager = SqliteConnectionManager::file(db_path);
            let db =
                Pool::new(manager).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            init_db(&db).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(AppState {
                db,
                data_dir,
                scan_lock: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_data,
            rescan,
            get_archives,
            archive_skill,
            archive_skills,
            delete_skill,
            read_skill_md,
            reveal_skill_md
        ])
        .run(tauri::generate_context!())
        .expect("error while running SkiLens");
}

fn init_db(db: &DbPool) -> Result<(), rusqlite::Error> {
    let conn = db.get().map_err(pool_error)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS archives (
            name TEXT PRIMARY KEY,
            archived_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scan_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skills (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('confirmed', 'probable', 'loaded_only', 'available_only', 'never_seen')),
            invocations INTEGER NOT NULL,
            last_seen TEXT NOT NULL,
            last_invoked TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name TEXT NOT NULL,
            platform TEXT NOT NULL,
            confidence TEXT NOT NULL CHECK(confidence IN ('confirmed', 'probable', 'loaded')),
            signal TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            session_id TEXT NOT NULL,
            log_file TEXT NOT NULL,
            detail TEXT NOT NULL,
            FOREIGN KEY(skill_name) REFERENCES skills(name) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_events_skill_time ON events(skill_name, timestamp);
        ",
    )?;
    Ok(())
}

fn rescan_inner(state: &AppState) -> Result<SummaryPayload, String> {
    let _guard = state
        .scan_lock
        .try_lock()
        .map_err(|_| "scan already running".to_string())?;
    let options = ScanOptions::default();
    let mut records = discover_skills(&options.skill_roots);
    let (events, claude_stats) = scan_claude_logs(&mut records, &options.claude_log_roots)
        .map_err(|error| error.to_string())?;
    let (meta_events, meta_stats) = scan_claude_session_meta(&records, &options.claude_meta_roots)
        .map_err(|error| error.to_string())?;
    let (telemetry_events, telemetry_stats) =
        scan_claude_telemetry(&mut records, &options.claude_telemetry_roots)
            .map_err(|error| error.to_string())?;
    let mut all_events = events;
    all_events.extend(meta_events);
    all_events.extend(telemetry_events);
    let payload = summarize(
        &mut records,
        all_events,
        std::collections::BTreeMap::from([
            ("claude".to_string(), claude_stats),
            ("claude_session_meta".to_string(), meta_stats),
            ("claude_telemetry".to_string(), telemetry_stats),
        ]),
        &options,
    );
    fs::create_dir_all(&state.data_dir).map_err(|error| error.to_string())?;
    write_legacy_outputs(
        &payload,
        &state.data_dir.join("usage-data.js"),
        &state.data_dir.join("skill-usage-data.json"),
    )
    .map_err(|error| error.to_string())?;
    persist_summary(&state.db, &payload).map_err(|error| error.to_string())?;
    Ok(payload)
}

fn load_latest_payload(data_dir: &Path) -> Result<SummaryPayload, String> {
    let path = data_dir.join("skill-usage-data.json");
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn persist_summary(db: &DbPool, payload: &SummaryPayload) -> Result<(), rusqlite::Error> {
    let mut conn = db.get().map_err(pool_error)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM skills", [])?;
    tx.execute("DELETE FROM events", [])?;
    for skill in &payload.skills {
        tx.execute(
            "INSERT INTO skills(name, description, status, invocations, last_seen, last_invoked, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                skill.name,
                skill.description,
                skill.status,
                skill.invocations as i64,
                skill.last_seen,
                skill.last_invoked,
                serde_json::to_string(skill).unwrap_or_default(),
            ],
        )?;
        for event in &skill.events {
            tx.execute(
                "INSERT INTO events(skill_name, platform, confidence, signal, timestamp, session_id, log_file, detail)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    event.skill,
                    event.platform,
                    event.confidence,
                    event.signal,
                    event.timestamp,
                    event.session_id,
                    event.log_file,
                    event.detail,
                ],
            )?;
        }
    }
    tx.execute(
        "INSERT INTO scan_meta(key, value) VALUES ('generated_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![payload.generated_at],
    )?;
    tx.commit()
}

fn load_archives(db: &DbPool) -> Result<ArchivePayload, String> {
    let conn = db.get().map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name FROM archives ORDER BY name")
        .map_err(|error| error.to_string())?;
    let skills = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let updated_at = conn
        .query_row(
            "SELECT value FROM scan_meta WHERE key = 'archives_updated_at'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(ArchivePayload { skills, updated_at })
}

fn archive_skill_names(db: &DbPool, names: &[String]) -> Result<ArchivePayload, String> {
    let mut clean = names
        .iter()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    clean.sort_unstable();
    clean.dedup();

    let mut conn = db.get().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    for name in clean {
        tx.execute(
            "INSERT INTO archives(name, archived_at) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET archived_at = excluded.archived_at",
            params![name, now],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.execute(
        "INSERT INTO scan_meta(key, value) VALUES ('archives_updated_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![now],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    load_archives(db)
}

fn is_allowed_skill_md_path(path: &Path) -> bool {
    if path.file_name().and_then(|value| value.to_str()) != Some("SKILL.md") {
        return false;
    }
    let Ok(resolved) = path.canonicalize() else {
        return false;
    };
    is_skill_md_under_allowed_roots(&resolved, &default_skill_roots())
}

fn is_skill_md_under_allowed_roots(resolved_skill_md: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| {
        root.canonicalize().map_or(false, |root| {
            resolved_skill_md.starts_with(&root)
                && resolved_skill_md
                    .parent()
                    .is_some_and(|skill_dir| skill_dir != root.as_path())
        })
    })
}

fn move_skill_paths_to_trash(
    name: &str,
    skill_md_paths: &[PathBuf],
) -> Result<Vec<MoveEntry>, String> {
    let mut moved = Vec::new();
    if skill_md_paths.is_empty() {
        return Ok(moved);
    }

    let trash_root = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home directory".to_string())?
        .join(".Trash/skills-stats");
    fs::create_dir_all(&trash_root).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let safe_name = sanitize_trash_name(name);

    for skill_md in skill_md_paths {
        let Some(src_dir) = skill_md.parent() else {
            continue;
        };
        let mut dest = trash_root.join(format!("{safe_name}-{stamp}"));
        let mut index = 2;
        while dest.exists() {
            dest = trash_root.join(format!("{safe_name}-{stamp}-{index}"));
            index += 1;
        }
        match fs::rename(src_dir, &dest) {
            Ok(()) => moved.push(MoveEntry {
                from: src_dir.to_string_lossy().to_string(),
                to: dest.to_string_lossy().to_string(),
            }),
            Err(error) => {
                rollback_moves(&moved);
                return Err(format!("failed to move skill directory: {error}"));
            }
        }
    }

    Ok(moved)
}

fn rollback_moves(moved: &[MoveEntry]) {
    for entry in moved.iter().rev() {
        let _ = fs::rename(&entry.to, &entry.from);
    }
}

fn sanitize_trash_name(name: &str) -> String {
    let cleaned = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .take(120)
        .collect::<String>();
    if cleaned.is_empty() {
        "skill".to_string()
    } else {
        cleaned
    }
}

fn default_skill_roots() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        home.join(".claude/skills"),
        home.join(".cc-switch/skills"),
        home.join(".agents/skills"),
        home.join(".codex/skills"),
        home.join(".config/opencode/skills"),
    ]
}

fn pool_error(error: r2d2::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

#[cfg(test)]
mod tests {
    use super::is_skill_md_under_allowed_roots;
    use std::fs;

    #[test]
    fn root_level_skill_md_is_not_allowed_for_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("skills");
        fs::create_dir_all(&root).unwrap();
        let root_skill_md = root.join("SKILL.md");
        fs::write(&root_skill_md, "# root\n").unwrap();

        assert!(!is_skill_md_under_allowed_roots(
            &root_skill_md.canonicalize().unwrap(),
            &[root]
        ));
    }

    #[test]
    fn nested_skill_md_is_allowed_for_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("skills");
        let skill_md = root.join("good-skill/SKILL.md");
        fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
        fs::write(&skill_md, "# good\n").unwrap();

        assert!(is_skill_md_under_allowed_roots(
            &skill_md.canonicalize().unwrap(),
            &[root]
        ));
    }
}

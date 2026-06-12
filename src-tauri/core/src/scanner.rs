use chrono::{DateTime, SecondsFormat, Utc};
use base64::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

const MAX_SKILL_NAME_CHARS: usize = 100;
const DEFAULT_SKILL_DISCOVERY_MAX_DEPTH: usize = 9;
const MAX_SKILL_DESCRIPTION_CHARS: usize = 240;
const MAX_EVENT_DETAIL_CHARS: usize = 500;
const PLUGIN_CACHE_MARKERS: [&str; 2] = ["/.claude/plugins/cache/", "/.codex/plugins/cache/"];
const SKIP_DIRS: [&str; 12] = [
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    "projects",
    "sessions",
    "transcripts",
    "tasks",
];
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum ScannerError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillSource {
    pub path: String,
    pub platform: String,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct SkillRecord {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub sources: Vec<SkillSource>,
    #[serde(skip)]
    pub available_sessions: BTreeSet<String>,
    #[serde(default)]
    pub available_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Event {
    pub skill: String,
    pub platform: String,
    pub confidence: String,
    pub signal: String,
    pub timestamp: String,
    pub session_id: String,
    pub log_file: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ScanStats {
    #[serde(flatten)]
    pub values: BTreeMap<String, usize>,
}

impl ScanStats {
    fn incr(&mut self, key: &str) {
        *self.values.entry(key.to_string()).or_insert(0) += 1;
    }
}

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub skill_roots: Vec<PathBuf>,
    pub claude_log_roots: Vec<PathBuf>,
    pub claude_meta_roots: Vec<PathBuf>,
    pub claude_telemetry_roots: Vec<PathBuf>,
    pub max_events_per_skill: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            skill_roots: vec![
                home.join(".claude/skills"),
                home.join(".cc-switch/skills"),
                home.join(".agents/skills"),
            ],
            claude_log_roots: vec![
                home.join(".claude/transcripts"),
                home.join(".claude/projects"),
                home.join(".claude/tasks"),
            ],
            claude_meta_roots: vec![home.join(".claude/usage-data/session-meta")],
            claude_telemetry_roots: vec![home.join(".claude/telemetry")],
            max_events_per_skill: 80,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillPayload {
    pub name: String,
    pub description: String,
    pub status: String,
    pub confirmed: usize,
    pub probable: usize,
    pub loaded: usize,
    pub invocations: usize,
    pub available: usize,
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
    #[serde(rename = "loadedSessionCount")]
    pub loaded_session_count: usize,
    #[serde(rename = "availableSessionCount")]
    pub available_session_count: usize,
    #[serde(rename = "allSessionCount")]
    pub all_session_count: usize,
    #[serde(rename = "lastSeen")]
    pub last_seen: String,
    #[serde(rename = "lastInvoked")]
    pub last_invoked: String,
    #[serde(rename = "dailyInvocations")]
    pub daily_invocations: BTreeMap<String, usize>,
    pub sources: Vec<SkillSource>,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryPayload {
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    pub totals: BTreeMap<String, usize>,
    pub stats: BTreeMap<String, BTreeMap<String, usize>>,
    #[serde(rename = "skillRoots")]
    pub skill_roots: Vec<String>,
    #[serde(rename = "logRoots")]
    pub log_roots: BTreeMap<String, Vec<String>>,
    pub skills: Vec<SkillPayload>,
}

pub fn is_plausible_skill_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_SKILL_NAME_CHARS {
        return false;
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
}

fn is_plausible_skill_path(path: &str) -> bool {
    let normalized = normalize_path_text(path);
    if !normalized.starts_with('/') {
        return false;
    }
    if !normalized.contains("/skills/") && !normalized.ends_with("/SKILL.md") {
        return false;
    }
    is_plausible_skill_name(&skill_name_from_path(&normalized))
}

fn normalize_path_text(path: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::RootDir => parts.clear(),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            _ => {}
        }
    }
    format!("/{}", parts.join("/"))
}

fn skill_name_from_path(path: &str) -> String {
    let normalized = normalize_path_text(path);
    if normalized.ends_with("/SKILL.md") {
        Path::new(&normalized)
            .parent()
            .and_then(Path::file_name)
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        Path::new(&normalized)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default()
    }
}

fn platform_for_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.contains("/.claude/") {
        "claude"
    } else if text.contains("/.codex/") {
        "codex"
    } else if text.contains("/.agents/") {
        "agents"
    } else if text.contains("/.cc-switch/") {
        "cc-switch"
    } else if text.contains("/.config/opencode/") {
        "opencode"
    } else {
        "local"
    }
    .to_string()
}

fn origin_for_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    for marker in [
        "/.claude/plugins/cache/",
        "/.codex/plugins/cache/",
        "/.claude/skills/",
        "/.codex/skills/",
        "/.agents/skills/",
        "/.cc-switch/skills/",
        "/.config/opencode/skills/",
    ] {
        if text.contains(marker) {
            return marker.trim_matches('/').to_string();
        }
    }
    "custom".to_string()
}

fn is_plugin_cache(path: &Path) -> bool {
    let text = path.to_string_lossy();
    PLUGIN_CACHE_MARKERS.iter().any(|marker| text.contains(marker))
}

fn should_skip_dir(entry: &DirEntry, root: &Path) -> bool {
    if entry.depth() > DEFAULT_SKILL_DISCOVERY_MAX_DEPTH {
        return true;
    }
    if is_plugin_cache(entry.path()) {
        return true;
    }
    if entry.path() == root {
        return false;
    }
    entry
        .file_name()
        .to_str()
        .map(|name| SKIP_DIRS.contains(&name) || name.starts_with(".tmp"))
        .unwrap_or(false)
}

fn parse_skill_md(path: &Path) -> (String, String) {
    let fallback_name = path
        .parent()
        .and_then(Path::file_name)
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let Ok(text) = fs::read_to_string(path) else {
        return (fallback_name, String::new());
    };
    let mut name = fallback_name;
    let mut description = String::new();

    if text.starts_with("---") {
        let mut parts = text.splitn(3, "---");
        let _ = parts.next();
        if let Some(frontmatter) = parts.next() {
            for line in frontmatter.lines() {
                if let Some(value) = line.strip_prefix("name:") {
                    name = value.trim().trim_matches(['"', '\'']).to_string();
                } else if let Some(value) = line.strip_prefix("description:") {
                    description = value.trim().trim_matches(['"', '\'']).to_string();
                }
            }
        }
    }

    if description.is_empty() {
        for line in text.lines() {
            let clean = line.trim();
            if !clean.is_empty() && !clean.starts_with('#') && clean != "---" {
                description = clean.chars().take(MAX_SKILL_DESCRIPTION_CHARS).collect();
                break;
            }
        }
    }

    (name, description)
}

pub fn discover_skills(roots: &[PathBuf]) -> BTreeMap<String, SkillRecord> {
    let mut records = BTreeMap::new();
    let mut seen_paths = HashSet::new();

    for root in roots {
        if !root.exists() {
            continue;
        }
        let walker = WalkDir::new(root).into_iter().filter_entry(|entry| !should_skip_dir(entry, root));
        for entry in walker.filter_map(Result::ok) {
            if !entry.file_type().is_file() || entry.file_name() != "SKILL.md" {
                continue;
            }
            let path = entry.path().to_path_buf();
            if is_plugin_cache(&path) {
                continue;
            }
            let path_text = path.to_string_lossy().to_string();
            if !seen_paths.insert(path_text.clone()) {
                continue;
            }
            let (name, description) = parse_skill_md(&path);
            let record = records.entry(name.clone()).or_insert_with(|| SkillRecord {
                name,
                ..SkillRecord::default()
            });
            if record.description.is_empty() && !description.is_empty() {
                record.description = description;
            }
            record.sources.push(SkillSource {
                path: path_text,
                platform: platform_for_path(&path),
                origin: origin_for_path(&path),
            });
        }
    }

    records
}

pub fn scan_claude_logs(
    records: &mut BTreeMap<String, SkillRecord>,
    roots: &[PathBuf],
) -> Result<(Vec<Event>, ScanStats), ScannerError> {
    let mut events = Vec::new();
    let mut stats = ScanStats::default();

    for path in iter_jsonl_files(roots) {
        stats.incr("files");
        let file = File::open(&path)?;
        let reader = BufReader::new(file);
        for (index, raw_line) in reader.lines().enumerate() {
            let line_no = index + 1;
            let raw_line = raw_line?;
            if raw_line.trim().is_empty() {
                continue;
            }
            let Ok(obj) = serde_json::from_str::<Value>(&raw_line) else {
                stats.incr("invalid_json_lines");
                continue;
            };
            stats.incr("json_lines");
            let timestamp = timestamp_for(&obj);
            let session_id = session_id_for(&path, &obj);

            let command_names = command_names(&obj, records);
            for name in command_names {
                add_event(
                    &mut events,
                    &name,
                    "claude",
                    "confirmed",
                    "slash-command",
                    &timestamp,
                    &session_id,
                    &path,
                    &format!("line {line_no}: /{name}"),
                );
            }

            for name in extract_skill_listing_names(&obj) {
                let record = records.entry(name.clone()).or_insert_with(|| SkillRecord {
                    name,
                    ..SkillRecord::default()
                });
                record.available_count += 1;
                record.available_sessions.insert(session_id.clone());
            }

            if raw_line.contains("Base directory for this skill:") {
                for text in iter_strings(&obj) {
                    if !text.contains("Base directory for this skill:") {
                        continue;
                    }
                    for path_text in extract_skill_instruction_paths(&text) {
                        if !is_plausible_skill_path(&path_text) {
                            stats.incr("ignored_invalid_skill_instruction_path");
                            continue;
                        }
                        let name = skill_name_from_path(&path_text);
                        add_event(
                            &mut events,
                            &name,
                            "claude",
                            "confirmed",
                            "skill-instruction",
                            &timestamp,
                            &session_id,
                            &path,
                            &format!("line {line_no}: {path_text}"),
                        );
                    }
                }
            }

            for item in walk_objects(&obj) {
                if is_tool_use_node(item) {
                    let tool_name = tool_name_for(item);
                    if matches!(tool_name.as_deref(), Some("Skill" | "skill")) {
                        let tool_input = tool_input_for(item);
                        let skill_name = tool_input
                            .and_then(|input| input.get("name").or_else(|| input.get("skill")))
                            .and_then(Value::as_str);
                        if let Some(skill_name) = skill_name {
                            add_event(
                                &mut events,
                                skill_name,
                                "claude",
                                "confirmed",
                                "skill-tool",
                                &timestamp,
                                &session_id,
                                &path,
                                &format!("line {line_no}: {}", joined_strings(item)),
                            );
                        }
                    } else if let Some(tool_name) = tool_name {
                        if tool_name == "Agent" {
                            let text = joined_strings(item);
                            if text.to_lowercase().contains("skill") {
                                if let Some(name) = records
                                    .keys()
                                    .find(|name| agent_mentions_skill(&text, name))
                                    .cloned()
                                {
                                    add_event(
                                        &mut events,
                                        &name,
                                        "claude",
                                        "confirmed",
                                        "agent-skill-request",
                                        &timestamp,
                                        &session_id,
                                        &path,
                                        &format!("line {line_no}: {text}"),
                                    );
                                }
                            }
                        } else if records.contains_key(&tool_name) {
                            add_event(
                                &mut events,
                                &tool_name,
                                "claude",
                                "confirmed",
                                "direct-skill-tool",
                                &timestamp,
                                &session_id,
                                &path,
                                &format!("line {line_no}: {}", joined_strings(item)),
                            );
                        }
                    }
                }

                if let Some(load_skills) = item.get("load_skills").and_then(Value::as_array) {
                    for raw in load_skills {
                        let key = raw.as_str().map(str::to_string).unwrap_or_else(|| raw.to_string());
                        add_event(
                            &mut events,
                            &skill_name_from_path(&key),
                            "claude",
                            "confirmed",
                            "load_skills",
                            &timestamp,
                            &session_id,
                            &path,
                            &format!("line {line_no}: {key}"),
                        );
                    }
                }

                let file_value = item
                    .get("filePath")
                    .or_else(|| item.get("path"))
                    .and_then(Value::as_str);
                if let Some(file_value) = file_value {
                    if file_value.ends_with("SKILL.md") {
                        add_event(
                            &mut events,
                            &skill_name_from_path(file_value),
                            "claude",
                            "probable",
                            "read-SKILL.md",
                            &timestamp,
                            &session_id,
                            &path,
                            &format!("line {line_no}: {file_value}"),
                        );
                    }
                }
            }
        }
    }

    Ok((events, stats))
}

pub fn scan_claude_session_meta(
    records: &BTreeMap<String, SkillRecord>,
    roots: &[PathBuf],
) -> Result<(Vec<Event>, ScanStats), ScannerError> {
    let mut events = Vec::new();
    let mut stats = ScanStats::default();
    let slash_re = Regex::new(r"(?:^|\s)/([A-Za-z0-9_.:-]+)(?:\s|$)").expect("valid regex");

    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).max_depth(1).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() || entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            stats.incr("files");
            let text = fs::read_to_string(entry.path())?;
            let Ok(obj) = serde_json::from_str::<Value>(&text) else {
                stats.incr("invalid_json_files");
                continue;
            };
            stats.incr("json_files");
            let Some(prompt) = obj.get("first_prompt").and_then(Value::as_str) else {
                continue;
            };
            if !prompt.contains('/') {
                continue;
            }
            let timestamp = obj
                .get("timestamp")
                .or_else(|| obj.get("started_at"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let session_id = entry
                .path()
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            for caps in slash_re.captures_iter(prompt) {
                let Some(name) = caps.get(1).map(|value| value.as_str()) else {
                    continue;
                };
                if !records.contains_key(name) {
                    continue;
                }
                add_event(
                    &mut events,
                    name,
                    "claude",
                    "probable",
                    "session-meta-slash",
                    timestamp,
                    &session_id,
                    entry.path(),
                    &prompt.chars().take(MAX_EVENT_DETAIL_CHARS).collect::<String>(),
                );
            }
        }
    }

    Ok((events, stats))
}

pub fn scan_claude_telemetry(
    records: &mut BTreeMap<String, SkillRecord>,
    roots: &[PathBuf],
) -> Result<(Vec<Event>, ScanStats), ScannerError> {
    let mut events = Vec::new();
    let mut stats = ScanStats::default();

    for path in iter_json_files(roots) {
        stats.incr("files");
        let file = File::open(&path)?;
        let reader = BufReader::new(file);
        for (index, raw_line) in reader.lines().enumerate() {
            let line_no = index + 1;
            let raw_line = raw_line?;
            if raw_line.trim().is_empty() {
                continue;
            }
            let Ok(obj) = serde_json::from_str::<Value>(&raw_line) else {
                stats.incr("invalid_json_lines");
                continue;
            };
            stats.incr("json_lines");
            let Some(event_data) = obj.get("event_data").and_then(Value::as_object) else {
                continue;
            };
            if event_data.get("event_name").and_then(Value::as_str) != Some("tengu_skill_loaded") {
                continue;
            }
            let metadata = parse_metadata_json(event_data.get("additional_metadata"));
            let name = event_data
                .get("skill_name")
                .and_then(Value::as_str)
                .or_else(|| metadata.get("skill_name").and_then(Value::as_str))
                .unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let Some(record) = records.get_mut(name) else {
                stats.incr("ignored_untracked_loaded");
                continue;
            };
            if record.sources.is_empty() {
                stats.incr("ignored_untracked_loaded");
                continue;
            }
            let loaded_from = metadata
                .get("skill_loaded_from")
                .and_then(Value::as_str)
                .or_else(|| event_data.get("skill_loaded_from").and_then(Value::as_str))
                .unwrap_or("");
            let source = metadata
                .get("skill_source")
                .and_then(Value::as_str)
                .or_else(|| event_data.get("skill_source").and_then(Value::as_str))
                .unwrap_or("");
            if record.description.is_empty() && !source.is_empty() {
                record.description = format!("Telemetry skill source: {source}");
            }
            add_event(
                &mut events,
                name,
                "claude",
                "loaded",
                "telemetry-skill-loaded",
                event_data
                    .get("client_timestamp")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                event_data
                    .get("session_id")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| path.file_stem().and_then(|value| value.to_str()).unwrap_or("")),
                &path,
                &format!("line {line_no}: loaded_from={loaded_from} source={source}"),
            );
        }
    }

    Ok((events, stats))
}

pub fn summarize(
    records: &mut BTreeMap<String, SkillRecord>,
    events: Vec<Event>,
    stats: BTreeMap<String, ScanStats>,
    options: &ScanOptions,
) -> SummaryPayload {
    let mut by_skill: BTreeMap<String, Vec<Event>> = BTreeMap::new();
    let mut seen_event_keys = HashSet::new();
    for event in events {
        let key = (
            event.skill.clone(),
            event.signal.clone(),
            event.session_id.clone(),
            event.log_file.clone(),
            event.detail.clone(),
        );
        if !seen_event_keys.insert(key) {
            continue;
        }
        records.entry(event.skill.clone()).or_insert_with(|| SkillRecord {
            name: event.skill.clone(),
            ..SkillRecord::default()
        });
        by_skill.entry(event.skill.clone()).or_default().push(event);
    }

    let mut skills = Vec::new();
    let mut totals = BTreeMap::<String, usize>::new();
    for (name, record) in records.iter() {
        let mut skill_events = by_skill.remove(name).unwrap_or_default();
        skill_events.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
        if record.sources.is_empty() && skill_events.is_empty() {
            continue;
        }

        let confirmed = skill_events.iter().filter(|event| event.confidence == "confirmed").count();
        let probable = skill_events.iter().filter(|event| event.confidence == "probable").count();
        let loaded = skill_events.iter().filter(|event| event.confidence == "loaded").count();
        let slash_sessions: HashSet<&str> = skill_events
            .iter()
            .filter(|event| event.signal == "slash-command" && !event.session_id.is_empty())
            .map(|event| event.session_id.as_str())
            .collect();
        let invocation_events: Vec<&Event> = skill_events
            .iter()
            .filter(|event| {
                event.signal == "slash-command"
                    || (event.signal == "skill-tool"
                        && (event.session_id.is_empty()
                            || !slash_sessions.contains(event.session_id.as_str())))
            })
            .collect();
        let observed_sessions: BTreeSet<&str> = skill_events
            .iter()
            .filter(|event| {
                !event.session_id.is_empty()
                    && matches!(event.confidence.as_str(), "confirmed" | "probable")
            })
            .map(|event| event.session_id.as_str())
            .collect();
        let loaded_sessions: BTreeSet<&str> = skill_events
            .iter()
            .filter(|event| !event.session_id.is_empty() && event.confidence == "loaded")
            .map(|event| event.session_id.as_str())
            .collect();
        let mut all_sessions = observed_sessions.clone();
        all_sessions.extend(loaded_sessions.iter().copied());
        all_sessions.extend(record.available_sessions.iter().map(String::as_str));
        let last_seen = skill_events
            .iter()
            .filter(|event| !event.timestamp.is_empty())
            .map(|event| event.timestamp.as_str())
            .max()
            .unwrap_or("")
            .to_string();
        let last_invoked = invocation_events
            .iter()
            .filter(|event| !event.timestamp.is_empty())
            .map(|event| event.timestamp.as_str())
            .max()
            .unwrap_or("")
            .to_string();
        let mut daily_invocations = BTreeMap::new();
        for event in &invocation_events {
            if let Some(day) = timestamp_day(&event.timestamp) {
                *daily_invocations.entry(day).or_default() += 1;
            }
        }
        let status = if confirmed > 0 {
            "confirmed"
        } else if probable > 0 {
            "probable"
        } else if loaded > 0 {
            "loaded_only"
        } else if record.available_count > 0 {
            "available_only"
        } else {
            "never_seen"
        };

        incr_total(&mut totals, status);
        incr_total(&mut totals, "tracked");
        if !record.sources.is_empty() {
            incr_total(&mut totals, "installed");
        }
        *totals.entry("confirmed_events".to_string()).or_default() += confirmed;
        *totals.entry("probable_events".to_string()).or_default() += probable;
        *totals.entry("loaded_events".to_string()).or_default() += loaded;

        skills.push(SkillPayload {
            name: name.clone(),
            description: record.description.clone(),
            status: status.to_string(),
            confirmed,
            probable,
            loaded,
            invocations: invocation_events.len(),
            available: record.available_count,
            session_count: observed_sessions.len(),
            loaded_session_count: loaded_sessions.len(),
            available_session_count: record.available_sessions.len(),
            all_session_count: all_sessions.len(),
            last_seen,
            last_invoked,
            daily_invocations,
            sources: record.sources.clone(),
            events: skill_events
                .into_iter()
                .take(options.max_events_per_skill)
                .collect(),
        });
    }

    SummaryPayload {
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
        totals,
        stats: stats.into_iter().map(|(key, value)| (key, value.values)).collect(),
        skill_roots: options
            .skill_roots
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        log_roots: BTreeMap::from([(
            "claude".to_string(),
            options
                .claude_log_roots
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
        )]),
        skills,
    }
}

pub fn write_legacy_outputs(
    payload: &SummaryPayload,
    js_output: &Path,
    json_output: &Path,
) -> Result<(), ScannerError> {
    let json = serde_json::to_string_pretty(payload)? + "\n";
    let js = format!("window.SKILL_USAGE_DATA = {json};\n");
    write_pair_atomically(json_output, &json, js_output, &js)
}

fn write_pair_atomically(
    first_path: &Path,
    first_content: &str,
    second_path: &Path,
    second_content: &str,
) -> Result<(), ScannerError> {
    let first_original = fs::read(first_path).ok();
    let second_original = fs::read(second_path).ok();
    if let Err(error) = write_pair_atomically_inner(first_path, first_content, second_path, second_content) {
        restore_file(first_path, first_original.as_deref())?;
        restore_file(second_path, second_original.as_deref())?;
        return Err(error);
    }
    Ok(())
}

fn write_pair_atomically_inner(
    first_path: &Path,
    first_content: &str,
    second_path: &Path,
    second_content: &str,
) -> Result<(), ScannerError> {
    atomic_write(first_path, first_content)?;
    atomic_write(second_path, second_content)?;
    Ok(())
}

fn restore_file(path: &Path, original: Option<&[u8]>) -> Result<(), ScannerError> {
    if let Some(content) = original {
        fs::write(path, content)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), ScannerError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("output"),
        std::process::id(),
        unique_temp_suffix()
    ));
    {
        let mut file = File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(tmp, path)?;
    Ok(())
}

fn unique_temp_suffix() -> u128 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed) as u128;
    nanos ^ counter
}

fn incr_total(totals: &mut BTreeMap<String, usize>, key: &str) {
    *totals.entry(key.to_string()).or_default() += 1;
}

fn iter_jsonl_files(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in roots {
        if root.is_file() && root.extension().is_some_and(|ext| ext == "jsonl") {
            files.push(root.clone());
        } else if root.is_dir() {
            for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
                if entry.file_type().is_file()
                    && entry.path().extension().is_some_and(|ext| ext == "jsonl")
                {
                    files.push(entry.path().to_path_buf());
                }
            }
        }
    }
    files.sort();
    files
}

fn iter_json_files(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in roots {
        if root.is_file() && root.extension().is_some_and(|ext| ext == "json") {
            files.push(root.clone());
        } else if root.is_dir() {
            for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
                if entry.file_type().is_file()
                    && entry.path().extension().is_some_and(|ext| ext == "json")
                {
                    files.push(entry.path().to_path_buf());
                }
            }
        }
    }
    files.sort();
    files
}

fn command_names(obj: &Value, records: &BTreeMap<String, SkillRecord>) -> BTreeSet<String> {
    let re = Regex::new(r"<command-name>/([A-Za-z0-9_.:-]+)</command-name>").expect("valid regex");
    iter_strings(obj)
        .into_iter()
        .flat_map(|text| {
            re.captures_iter(&text)
                .filter_map(|caps| caps.get(1).map(|value| value.as_str().to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|name| records.contains_key(name))
        .collect()
}

fn extract_skill_instruction_paths(text: &str) -> Vec<String> {
    let re = Regex::new(r"Base directory for this skill:\s*(/[^\s\n\r]+)").expect("valid regex");
    re.captures_iter(text)
        .filter_map(|caps| caps.get(1).map(|value| value.as_str().trim().to_string()))
        .collect()
}

fn extract_skill_listing_names(obj: &Value) -> Vec<String> {
    let mut names = Vec::new();
    for item in walk_objects(obj) {
        if item.get("type").and_then(Value::as_str) != Some("skill_listing") {
            continue;
        }
        if let Some(raw_names) = item.get("names").and_then(Value::as_array) {
            for raw in raw_names {
                let name = raw.as_str().unwrap_or("").trim();
                if is_plausible_skill_name(name) {
                    names.push(name.to_string());
                }
            }
        } else if let Some(content) = item.get("content").and_then(Value::as_str) {
            for line in content.lines() {
                if let Some(rest) = line.strip_prefix("- ") {
                    let name = rest.split_once(':').map(|(name, _)| name).unwrap_or(rest).trim();
                    if is_plausible_skill_name(name) {
                        names.push(name.to_string());
                    }
                }
            }
        }
    }
    names
}

fn walk_objects(value: &Value) -> Vec<&Map<String, Value>> {
    let mut objects = Vec::new();
    walk_objects_inner(value, &mut objects);
    objects
}

fn walk_objects_inner<'a>(value: &'a Value, objects: &mut Vec<&'a Map<String, Value>>) {
    match value {
        Value::Object(map) => {
            objects.push(map);
            for value in map.values() {
                walk_objects_inner(value, objects);
            }
        }
        Value::Array(items) => {
            for value in items {
                walk_objects_inner(value, objects);
            }
        }
        _ => {}
    }
}

fn iter_strings(value: &Value) -> Vec<String> {
    let mut strings = Vec::new();
    iter_strings_inner(value, &mut strings);
    strings
}

fn iter_strings_inner(value: &Value, strings: &mut Vec<String>) {
    match value {
        Value::String(text) => strings.push(text.clone()),
        Value::Array(items) => {
            for value in items {
                iter_strings_inner(value, strings);
            }
        }
        Value::Object(map) => {
            for value in map.values() {
                iter_strings_inner(value, strings);
            }
        }
        _ => {}
    }
}

fn joined_strings(item: &Map<String, Value>) -> String {
    let text = iter_strings(&Value::Object(item.clone())).join(" ");
    text.chars().take(MAX_EVENT_DETAIL_CHARS).collect()
}

fn agent_mentions_skill(text: &str, name: &str) -> bool {
    let escaped = regex::escape(name);
    let patterns = [
        format!(r#"(?i)\bskill\s*[:=]\s*["']?{escaped}\b"#),
        format!(r#"(?i)\bAgent\s+{escaped}\b"#),
        format!(r#"(?i)/skills/{escaped}\b"#),
        format!(r#"(?i)\bload[_ -]?skills?\s*[:=].*\b{escaped}\b"#),
    ];
    patterns
        .iter()
        .any(|pattern| Regex::new(pattern).is_ok_and(|re| re.is_match(text)))
}

fn parse_metadata_json(raw: Option<&Value>) -> Map<String, Value> {
    let Some(text) = raw.and_then(Value::as_str) else {
        return Map::new();
    };
    if text.is_empty() {
        return Map::new();
    }
    if text.starts_with('{') {
        return serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
    }
    let padded = format!("{text}{}", "=".repeat((4 - text.len() % 4) % 4));
    if let Ok(bytes) = BASE64_STANDARD.decode(padded) {
        return String::from_utf8(bytes)
            .ok()
            .and_then(|decoded| serde_json::from_str::<Value>(&decoded).ok())
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
    }
    Map::new()
}

fn is_tool_use_node(item: &Map<String, Value>) -> bool {
    item.get("type").and_then(Value::as_str) == Some("tool_use")
        || item.contains_key("tool_use")
        || item.contains_key("name") && item.contains_key("input")
}

fn tool_name_for(item: &Map<String, Value>) -> Option<String> {
    item.get("name")
        .or_else(|| item.get("tool_name"))
        .or_else(|| item.get("tool"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn tool_input_for(item: &Map<String, Value>) -> Option<&Map<String, Value>> {
    item.get("input")
        .or_else(|| item.get("tool_input"))
        .and_then(Value::as_object)
}

fn add_event(
    events: &mut Vec<Event>,
    skill: &str,
    platform: &str,
    confidence: &str,
    signal: &str,
    timestamp: &str,
    session_id: &str,
    log_file: &Path,
    detail: &str,
) {
    if !is_plausible_skill_name(skill) {
        return;
    }
    events.push(Event {
        skill: skill.to_string(),
        platform: platform.to_string(),
        confidence: confidence.to_string(),
        signal: signal.to_string(),
        timestamp: normalize_timestamp(timestamp),
        session_id: session_id.to_string(),
        log_file: log_file.to_string_lossy().to_string(),
        detail: detail.chars().take(MAX_EVENT_DETAIL_CHARS).collect(),
    });
}

fn timestamp_for(obj: &Value) -> String {
    for key in ["timestamp", "created_at", "createdAt", "time"] {
        if let Some(value) = first_string(obj, key) {
            return value;
        }
    }
    String::new()
}

fn session_id_for(path: &Path, obj: &Value) -> String {
    for key in ["sessionId", "session_id", "conversation_id"] {
        if let Some(value) = first_string(obj, key) {
            return value;
        }
    }
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn first_string(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(key).and_then(Value::as_str) {
                return Some(found.to_string());
            }
            for child in map.values() {
                if let Some(found) = first_string(child, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|child| first_string(child, key)),
        _ => None,
    }
}

fn normalize_timestamp(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_else(|_| raw.to_string())
}

fn timestamp_day(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.with_timezone(&Utc).format("%Y-%m-%d").to_string())
}

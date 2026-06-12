use serde_json::json;
use skilens_core::{
    scan_claude_logs, scan_claude_session_meta, scan_claude_telemetry, summarize, Event,
    ScanOptions, SkillRecord, SkillSource,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn write_jsonl(path: &Path, entries: Vec<serde_json::Value>) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let body = entries
        .into_iter()
        .map(|entry| serde_json::to_string(&entry).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{body}\n")).unwrap();
}

fn scan_entries(
    tmp: &Path,
    entries: Vec<serde_json::Value>,
    mut records: BTreeMap<String, SkillRecord>,
) -> (Vec<Event>, skilens_core::SummaryPayload) {
    let log_path = tmp.join(".claude/projects/proj/session.jsonl");
    write_jsonl(&log_path, entries);
    let roots = vec![tmp.join(".claude/projects")];
    let (events, stats) = scan_claude_logs(&mut records, &roots).unwrap();
    let options = ScanOptions {
        skill_roots: vec![],
        claude_log_roots: roots,
        claude_meta_roots: vec![],
        claude_telemetry_roots: vec![],
        max_events_per_skill: 20,
    };
    let payload = summarize(&mut records, events.clone(), BTreeMap::from([("claude".to_string(), stats)]), &options);
    (events, payload)
}

fn skill<'a>(payload: &'a skilens_core::SummaryPayload, name: &str) -> &'a skilens_core::SkillPayload {
    payload.skills.iter().find(|skill| skill.name == name).unwrap()
}

fn record(name: &str) -> SkillRecord {
    SkillRecord {
        name: name.to_string(),
        ..SkillRecord::default()
    }
}

#[test]
fn slash_command_counts_as_invocation() {
    let tmp = tempfile::tempdir().unwrap();
    let records = BTreeMap::from([("baoyu-design".to_string(), record("baoyu-design"))]);
    let (_events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "uuid": "u1",
            "type": "user",
            "timestamp": "2026-06-09T10:52:20.786Z",
            "sessionId": "s1",
            "message": {
                "role": "user",
                "content": [{
                    "type": "text",
                    "text": "<command-name>/baoyu-design</command-name><command-message>baoyu-design</command-message>"
                }]
            }
        })],
        records,
    );

    let skill = skill(&payload, "baoyu-design");
    assert_eq!(skill.invocations, 1);
    assert_eq!(skill.events[0].signal, "slash-command");
}

#[test]
fn skill_tool_use_counts_as_invocation_with_skill_key() {
    let tmp = tempfile::tempdir().unwrap();
    let records = BTreeMap::from([("baoyu-design".to_string(), record("baoyu-design"))]);
    let (_events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "uuid": "a1",
            "type": "assistant",
            "timestamp": "2026-06-09T10:52:21.000Z",
            "sessionId": "s1",
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "name": "Skill",
                    "input": {"skill": "baoyu-design", "args": "mock up settings"}
                }]
            }
        })],
        records,
    );

    let skill = skill(&payload, "baoyu-design");
    assert_eq!(skill.invocations, 1);
    assert_eq!(skill.events[0].signal, "skill-tool");
}

#[test]
fn project_path_after_base_directory_is_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let (events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "uuid": "u1",
            "type": "user",
            "timestamp": "2026-05-13T08:06:23.656Z",
            "sessionId": "s1",
            "message": {
                "role": "user",
                "content": "Base directory for this skill: /Users/shentao/CodeStore/workCodes/back1/scf-mihome-facade"
            }
        })],
        BTreeMap::new(),
    );

    assert!(events.is_empty());
    assert!(!payload.skills.iter().any(|skill| skill.name == "scf-mihome-facade"));
}

#[test]
fn skill_instruction_is_evidence_not_invocation() {
    let tmp = tempfile::tempdir().unwrap();
    let (_events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "uuid": "u1",
            "type": "user",
            "timestamp": "2026-05-27T12:44:18.926Z",
            "sessionId": "s1",
            "message": {
                "role": "user",
                "content": "Base directory for this skill: /Users/shentao/.claude/plugins/cache/superpowers/5.1.0/skills/writing-plans"
            }
        })],
        BTreeMap::new(),
    );

    let skill = skill(&payload, "writing-plans");
    assert_eq!(skill.status, "confirmed");
    assert_eq!(skill.confirmed, 1);
    assert_eq!(skill.invocations, 0);
}

#[test]
fn only_slash_and_skill_tool_count_as_invocations() {
    let mut records = BTreeMap::from([("example-skill".to_string(), record("example-skill"))]);
    let events = vec![
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "agent-skill-request".into(), timestamp: "2026-01-01T00:00:00Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "agent".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "direct-skill-tool".into(), timestamp: "2026-01-01T00:00:01Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "direct".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "skill-instruction".into(), timestamp: "2026-01-01T00:00:02Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "instruction".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "load_skills".into(), timestamp: "2026-01-01T00:00:03Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "load".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "probable".into(), signal: "session-meta-slash".into(), timestamp: "2026-01-01T00:00:04Z".into(), session_id: "s1".into(), log_file: "meta.json".into(), detail: "/example-skill".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "slash-command".into(), timestamp: "2026-01-01T00:00:05Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "/example-skill".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "skill-tool".into(), timestamp: "2026-01-01T00:00:06Z".into(), session_id: "s1".into(), log_file: "log.jsonl".into(), detail: "tool duplicate".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "skill-tool".into(), timestamp: "2026-01-01T00:00:07Z".into(), session_id: "s2".into(), log_file: "log2.jsonl".into(), detail: "tool only".into() },
        Event { skill: "example-skill".into(), platform: "claude".into(), confidence: "confirmed".into(), signal: "skill-instruction".into(), timestamp: "2026-01-01T00:00:09Z".into(), session_id: "s3".into(), log_file: "log3.jsonl".into(), detail: "newer evidence".into() },
    ];
    let options = ScanOptions {
        skill_roots: vec![],
        claude_log_roots: vec![],
        claude_meta_roots: vec![],
        claude_telemetry_roots: vec![],
        max_events_per_skill: 20,
    };
    let payload = summarize(&mut records, events, BTreeMap::new(), &options);

    let skill = skill(&payload, "example-skill");
    assert_eq!(skill.invocations, 2);
    assert_eq!(skill.last_invoked, "2026-01-01T00:00:07Z");
    assert_eq!(skill.last_seen, "2026-01-01T00:00:09Z");
}

#[test]
fn agent_skill_request_is_confirmed_evidence_not_invocation() {
    let tmp = tempfile::tempdir().unwrap();
    let records = BTreeMap::from([("dev-guides".to_string(), record("dev-guides"))]);
    let (_events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "timestamp": "2026-06-09T10:52:21.000Z",
            "sessionId": "s1",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Agent",
                    "input": {"prompt": "Use skill: \"dev-guides\" to review this change"}
                }]
            }
        })],
        records,
    );

    let skill = skill(&payload, "dev-guides");
    assert_eq!(skill.confirmed, 1);
    assert_eq!(skill.invocations, 0);
    assert_eq!(skill.events[0].signal, "agent-skill-request");
}

#[test]
fn session_meta_slash_is_probable_evidence_not_invocation() {
    let tmp = tempfile::tempdir().unwrap();
    let meta_root = tmp.path().join(".claude/usage-data/session-meta");
    fs::create_dir_all(&meta_root).unwrap();
    fs::write(
        meta_root.join("session-a.json"),
        serde_json::to_string(&json!({
            "first_prompt": "/dev-guides check this repo",
            "timestamp": "2026-06-09T10:52:21.000Z"
        }))
        .unwrap(),
    )
    .unwrap();
    let records = BTreeMap::from([("dev-guides".to_string(), record("dev-guides"))]);
    let (events, stats) = scan_claude_session_meta(&records, &[meta_root]).unwrap();
    let mut records = records;
    let options = ScanOptions {
        skill_roots: vec![],
        claude_log_roots: vec![],
        claude_meta_roots: vec![],
        claude_telemetry_roots: vec![],
        max_events_per_skill: 20,
    };
    let payload = summarize(
        &mut records,
        events,
        BTreeMap::from([("claude_session_meta".to_string(), stats)]),
        &options,
    );

    let skill = skill(&payload, "dev-guides");
    assert_eq!(skill.probable, 1);
    assert_eq!(skill.invocations, 0);
    assert_eq!(skill.events[0].signal, "session-meta-slash");
}

#[test]
fn telemetry_loaded_requires_installed_source() {
    let tmp = tempfile::tempdir().unwrap();
    let telemetry = tmp.path().join(".claude/telemetry/events.json");
    write_jsonl(
        &telemetry,
        vec![json!({
            "event_data": {
                "event_name": "tengu_skill_loaded",
                "skill_name": "dev-guides",
                "client_timestamp": "2026-06-09T10:52:21.000Z",
                "session_id": "s1"
            }
        })],
    );
    let mut records = BTreeMap::from([(
        "dev-guides".to_string(),
        SkillRecord {
            name: "dev-guides".to_string(),
            sources: vec![SkillSource {
                path: "/tmp/dev-guides/SKILL.md".to_string(),
                platform: "claude".to_string(),
                origin: "custom".to_string(),
            }],
            ..SkillRecord::default()
        },
    )]);
    let (events, stats) = scan_claude_telemetry(&mut records, &[tmp.path().join(".claude/telemetry")]).unwrap();
    let options = ScanOptions {
        skill_roots: vec![],
        claude_log_roots: vec![],
        claude_meta_roots: vec![],
        claude_telemetry_roots: vec![],
        max_events_per_skill: 20,
    };
    let payload = summarize(
        &mut records,
        events,
        BTreeMap::from([("claude_telemetry".to_string(), stats)]),
        &options,
    );

    let skill = skill(&payload, "dev-guides");
    assert_eq!(skill.loaded, 1);
    assert_eq!(skill.status, "loaded_only");
    assert_eq!(skill.invocations, 0);
}

#[test]
fn daily_invocations_are_not_limited_by_event_sample() {
    let mut records = BTreeMap::from([("example-skill".to_string(), record("example-skill"))]);
    let events = (0..5)
        .map(|i| Event {
            skill: "example-skill".into(),
            platform: "claude".into(),
            confidence: "confirmed".into(),
            signal: "skill-tool".into(),
            timestamp: format!("2026-01-0{}T00:00:00Z", i + 1),
            session_id: format!("s{i}"),
            log_file: "log.jsonl".into(),
            detail: format!("tool {i}"),
        })
        .collect::<Vec<_>>();
    let options = ScanOptions {
        skill_roots: vec![],
        claude_log_roots: vec![],
        claude_meta_roots: vec![],
        claude_telemetry_roots: vec![],
        max_events_per_skill: 2,
    };
    let payload = summarize(&mut records, events, BTreeMap::new(), &options);
    let skill = skill(&payload, "example-skill");

    assert_eq!(skill.invocations, 5);
    assert_eq!(skill.events.len(), 2);
    assert_eq!(skill.daily_invocations.values().sum::<usize>(), 5);
}

#[test]
fn textual_skill_tool_fallback_does_not_create_false_skill() {
    let tmp = tempfile::tempdir().unwrap();
    let (events, payload) = scan_entries(
        tmp.path(),
        vec![json!({
            "uuid": "a1",
            "type": "assistant",
            "timestamp": "2026-05-14T22:38:43.230Z",
            "sessionId": "s1",
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "name": "Skill",
                    "input": {},
                    "text": "Skill Get issue XM-4 current status"
                }]
            }
        })],
        BTreeMap::new(),
    );

    assert!(events.is_empty());
    assert!(!payload.skills.iter().any(|skill| skill.name == "Get" || skill.name == "XM-4"));
}

#[test]
fn plugin_cache_is_not_discovered_as_installed() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_md = tmp.path()
        .join(".codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.8.1/skills/ce-clean-gone-branches/SKILL.md");
    fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
    fs::write(&skill_md, "---\nname: ce-clean-gone-branches\n---\n").unwrap();

    let records = skilens_core::discover_skills(&[PathBuf::from(tmp.path())]);

    assert!(!records.contains_key("ce-clean-gone-branches"));
}

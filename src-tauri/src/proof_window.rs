//! Fixed developer proof controls; never compiled into ordinary builds.
use std::{
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    sync::atomic::{AtomicBool, AtomicU16, Ordering},
    time::{Duration, Instant},
};
use tauri::Manager;
pub const SCRIPT: &str = include_str!("proof_window.js");
/// The probe writes this file into the proof root once its fixture is staged.
/// Until it appears the app publishes nothing, so the probe can seed a profile
/// or a CLI home into a root that is still empty.
pub const STAGED_FILE: &str = "staged.json";
const MAX_STAGE_BYTES: u64 = 8 * 1024;
const MAX_FIXTURE_PATH: usize = 4096;
pub const STAGE_SECONDS: u64 = 240;
pub const WATCHDOG_SECONDS: u64 = 300;
/// A staged run adds a fixture install, a runtime publish and one service
/// migration to the same window; the ordinary budget cannot cover it.
pub const STAGED_WATCHDOG_SECONDS: u64 = 900;
fn read_stage(path: &Path) -> Result<Vec<u8>, &'static str> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "proof_stage")?;
    let info = file.metadata().map_err(|_| "proof_stage")?;
    if !info.is_file()
        || info.uid() != unsafe { libc::getuid() }
        || info.nlink() != 1
        || info.mode() & 0o7777 != 0o600
        || info.len() > MAX_STAGE_BYTES
    {
        return Err("proof_stage");
    }
    let mut raw = Vec::new();
    file.take(MAX_STAGE_BYTES)
        .read_to_end(&mut raw)
        .map_err(|_| "proof_stage")?;
    Ok(raw)
}
fn fixture_home(raw: &[u8]) -> Result<Option<String>, &'static str> {
    let value: serde_json::Value = serde_json::from_slice(raw).map_err(|_| "proof_stage")?;
    let object = value.as_object().ok_or("proof_stage")?;
    if object.len() != 2 || object.get("schema_version") != Some(&serde_json::json!(1)) {
        return Err("proof_stage");
    }
    match object.get("home").ok_or("proof_stage")? {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(home) => {
            // Absolute, bounded, and free of anything a JS source line could
            // not carry verbatim. The JSON encoding below is the second guard.
            if !home.starts_with('/')
                || home.len() > MAX_FIXTURE_PATH
                || home.chars().any(|c| c < ' ' || c == '\u{7f}')
            {
                return Err("proof_stage");
            }
            Ok(Some(home.clone()))
        }
        _ => Err("proof_stage"),
    }
}
/// Block until the probe has staged its fixture, then read the home it names.
pub fn await_stage(root: &Path) -> Result<Option<String>, &'static str> {
    let path = root.join(STAGED_FILE);
    let deadline = Instant::now() + Duration::from_secs(STAGE_SECONDS);
    loop {
        if std::fs::symlink_metadata(&path).is_ok() {
            return fixture_home(&read_stage(&path)?);
        }
        if Instant::now() >= deadline {
            return Err("proof_stage_timeout");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
/// The developer script with its fixture constant prepended. The path is
/// serialized as a JSON string, so no staged path can end the statement or the
/// script; the two keys are written in a fixed order rather than through a map,
/// so the emitted line does not depend on serde_json's feature flags.
pub fn script(staged: bool, home: Option<&str>) -> String {
    let home = serde_json::to_string(&home).unwrap_or_else(|_| "null".into());
    format!("globalThis.__INSTO_PROOF__={{\"staged\":{staged},\"home\":{home}}};\n{SCRIPT}")
}
#[derive(Default)]
pub struct ProofWindow {
    failed: AtomicBool,
    reported: AtomicBool,
    progress: AtomicU16,
}
pub fn signal(event: &'static str) {
    println!("{}", serde_json::json!({"proof": event}));
    let _ = std::io::stdout().flush();
}
pub fn failure(app: &tauri::AppHandle, code: &'static str) {
    if let Some(state) = app.try_state::<ProofWindow>() {
        state.failed.store(true, Ordering::Release);
        println!("{}", serde_json::json!({"proof":"ui_failed", "code":code}));
        let _ = std::io::stdout().flush();
    }
}
pub fn exit_code(app: &tauri::AppHandle) -> i32 {
    i32::from(
        app.try_state::<ProofWindow>()
            .is_some_and(|s| s.failed.load(Ordering::Acquire)),
    )
}
pub fn title(app: &tauri::AppHandle, title: &str) {
    if let Some(code) = report(title) {
        if matches!(code, "script_started" | "form_ready") {
            progress(app, code, None);
            return;
        }
        let admission_closed = app
            .state::<std::sync::Arc<crate::state::DesktopState>>()
            .check_open()
            .is_err();
        if !accepts_terminal_title(admission_closed, code) {
            return;
        }
        if app
            .state::<ProofWindow>()
            .reported
            .swap(true, Ordering::AcqRel)
        {
            return;
        }
        if code == "ui_ready" {
            signal("ui_ready");
        } else {
            failure(app, code);
        }
    }
}
pub fn start(app: &tauri::AppHandle, watchdog: Duration) {
    signal("window_opened");
    let reader_app = app.clone();
    std::thread::spawn(move || match read_control(std::io::stdin().lock()) {
        Ok(true) => reader_app.exit(0),
        Ok(false) => close(&reader_app),
        Err(code) => {
            failure(&reader_app, code);
            close(&reader_app);
        }
    });
    let timeout_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(watchdog).await;
        if !timeout_app
            .state::<std::sync::Arc<crate::state::DesktopState>>()
            .drained()
        {
            failure(&timeout_app, "timeout");
            close(&timeout_app);
        }
    });
}
fn close(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.close().is_ok() {
            return;
        }
    }
    app.exit(1);
}
fn report(title: &str) -> Option<&'static str> {
    if title.len() > 64 {
        return None;
    }
    match title {
        "insto-proof:script_started" => Some("script_started"),
        "insto-proof:form_ready" => Some("form_ready"),
        "insto-proof:initialization_failed" => Some("initialization_failed"),
        "insto-proof:ui_ready" => Some("ui_ready"),
        "insto-proof:form" => Some("form"),
        "insto-proof:visibility" => Some("visibility"),
        "insto-proof:validation" => Some("validation"),
        "insto-proof:geometry" => Some("geometry"),
        "insto-proof:ipc" => Some("ipc"),
        "insto-proof:profile" => Some("profile"),
        "insto-proof:script" => Some("script"),
        "insto-proof:timeout" => Some("timeout"),
        _ => None,
    }
}
pub fn progress<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str, error: Option<&str>) {
    let Some(state) = app.try_state::<ProofWindow>() else {
        return;
    };
    let Some((bit, event)) = progress_code(event) else {
        return;
    };
    if state.progress.fetch_or(bit, Ordering::AcqRel) & bit != 0 {
        return;
    }
    if let Some(code) = error {
        println!(
            "{}",
            serde_json::json!({"proof":event,"code":error_code(code)})
        );
        let _ = std::io::stdout().flush();
    } else {
        signal(event);
    }
}
fn progress_code(event: &str) -> Option<(u16, &'static str)> {
    match event {
        "script_started" => Some((1, "script_started")),
        "form_ready" => Some((2, "form_ready")),
        "prepare_started" => Some((4, "prepare_started")),
        "prepare_ready" => Some((8, "prepare_ready")),
        "prepare_failed" => Some((16, "prepare_failed")),
        "inspect_started" => Some((32, "inspect_started")),
        "inspect_ready" => Some((64, "inspect_ready")),
        "inspect_failed" => Some((128, "inspect_failed")),
        "migrate_started" => Some((256, "migrate_started")),
        "migrate_ready" => Some((512, "migrate_ready")),
        "migrate_failed" => Some((1024, "migrate_failed")),
        _ => None,
    }
}
fn error_code(code: &str) -> &'static str {
    match code {
        "runtime_manifest" => "runtime_manifest",
        "runtime_incompatible" => "runtime_incompatible",
        "runtime_ownership" => "runtime_ownership",
        "runtime_integrity" => "runtime_integrity",
        "runtime_storage" => "runtime_storage",
        "runtime_timeout" => "runtime_timeout",
        "runtime_handshake" => "runtime_handshake",
        "invalid_token" => "invalid_token",
        "protocol" => "protocol",
        "transport" => "transport",
        "outcome_unknown" => "outcome_unknown",
        "busy" => "busy",
        "closed" => "closed",
        "launcher" => "launcher",
        _ => "proof_failed",
    }
}
fn accepts_terminal_title(admission_closed: bool, code: &str) -> bool {
    // Closing can cancel the UI's pending read/prepare. Its resulting DOM error
    // is expected during drain; the independent Rust watchdog remains active.
    !admission_closed || code == "ui_ready"
}
fn control(line: &[u8]) -> Option<bool> {
    match line {
        b"close\n" => Some(false),
        b"quit\n" => Some(true),
        _ => None,
    }
}
fn read_control(mut reader: impl Read) -> Result<bool, &'static str> {
    let mut line = Vec::with_capacity(6);
    loop {
        let mut byte = [0];
        match reader.read(&mut byte) {
            Ok(0) => return Ok(false),
            Ok(_) => {
                if line.len() == 6 {
                    return Err("control");
                }
                line.push(byte[0]);
                if byte[0] == b'\n' {
                    return control(&line).ok_or("control");
                }
            }
            Err(_) => return Err("control"),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_js_failures_after_admission_closes_do_not_fail_normal_drain() {
        for code in [
            "initialization_failed",
            "ipc",
            "timeout",
            "script",
            "profile",
        ] {
            assert!(accepts_terminal_title(false, code));
            assert!(!accepts_terminal_title(true, code));
        }
        assert!(accepts_terminal_title(false, "ui_ready"));
        assert!(accepts_terminal_title(true, "ui_ready"));
    }
    #[test]
    fn bounded_reader_closes_on_eof_and_rejects_untrusted_control() {
        use std::io::Cursor;
        assert_eq!(read_control(Cursor::new(b"")), Ok(false));
        assert_eq!(read_control(Cursor::new(b"cl")), Ok(false));
        assert_eq!(read_control(Cursor::new(b"close\n")), Ok(false));
        assert_eq!(read_control(Cursor::new(b"quit\n")), Ok(true));
        assert_eq!(read_control(Cursor::new(b"secret\n")), Err("control"));
        assert_eq!(read_control(Cursor::new(b"close\r\n")), Err("control"));
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("not emitted"))
            }
        }
        assert_eq!(read_control(Broken), Err("control"));
    }
    #[test]
    fn title_reports_are_exact_static_and_bounded() {
        assert_eq!(report("insto-proof:script_started"), Some("script_started"));
        assert_eq!(report("insto-proof:form_ready"), Some("form_ready"));
        assert_eq!(
            report("insto-proof:initialization_failed"),
            Some("initialization_failed")
        );
        assert_eq!(report("insto-proof:ui_ready"), Some("ui_ready"));
        assert_eq!(report("insto-proof:geometry"), Some("geometry"));
        for value in [
            "insto",
            "insto-proof:ui_ready\nsecret",
            "insto-proof:secret",
            "insto-proof:quit",
        ] {
            assert_eq!(report(value), None);
        }
        assert_eq!(report(&"x".repeat(10000)), None);
    }
    #[test]
    fn progress_is_a_finite_static_allowlist() {
        assert_eq!(
            progress_code("prepare_started"),
            Some((4, "prepare_started"))
        );
        assert_eq!(
            progress_code("inspect_failed"),
            Some((128, "inspect_failed"))
        );
        assert_eq!(
            progress_code("migrate_started"),
            Some((256, "migrate_started"))
        );
        assert_eq!(progress_code("migrate_ready"), Some((512, "migrate_ready")));
        assert_eq!(
            progress_code("migrate_failed"),
            Some((1024, "migrate_failed"))
        );
        for code in ["secret", "prepare_failed\nsecret", "ui_ready", "quit"] {
            assert_eq!(progress_code(code), None);
        }
    }
    #[test]
    fn staged_fixture_accepts_only_the_documented_document() {
        assert_eq!(
            fixture_home(br#"{"schema_version":1,"home":null}"#),
            Ok(None)
        );
        assert_eq!(
            fixture_home(br#"{"schema_version":1,"home":"/private/proof/cli home"}"#),
            Ok(Some("/private/proof/cli home".into()))
        );
        for body in [
            br#"{"schema_version":1}"#.as_slice(),
            br#"{"schema_version":2,"home":null}"#,
            br#"{"schema_version":1.0,"home":null}"#,
            br#"{"schema_version":1,"home":null,"extra":1}"#,
            br#"{"schema_version":1,"home":"relative/home"}"#,
            br#"{"schema_version":1,"home":""}"#,
            br#"{"schema_version":1,"home":7}"#,
            b"{\"schema_version\":1,\"home\":\"/a\\u0000b\"}",
            b"[]",
            b"not json",
        ] {
            assert_eq!(
                fixture_home(body),
                Err("proof_stage"),
                "{}",
                String::from_utf8_lossy(body)
            );
        }
        let long = format!(r#"{{"schema_version":1,"home":"/{}"}}"#, "a".repeat(4096));
        assert_eq!(fixture_home(long.as_bytes()), Err("proof_stage"));
    }
    #[test]
    fn the_injected_fixture_is_json_and_never_raw_text() {
        let plain = script(false, None);
        assert_eq!(
            plain.lines().next(),
            Some("globalThis.__INSTO_PROOF__={\"staged\":false,\"home\":null};")
        );
        assert!(plain.ends_with(SCRIPT));
        let hostile = script(true, Some("/a\"b</script>"));
        assert_eq!(
            hostile.lines().next(),
            Some("globalThis.__INSTO_PROOF__={\"staged\":true,\"home\":\"/a\\\"b</script>\"};")
        );
        assert!(hostile.ends_with(SCRIPT));
    }
    #[test]
    fn milestone_errors_never_forward_unknown_text() {
        assert_eq!(error_code("runtime_integrity"), "runtime_integrity");
        assert_eq!(error_code("transport"), "transport");
        assert_eq!(error_code("protocol"), "protocol");
        assert_eq!(error_code("secret\ntransport"), "proof_failed");
        assert_eq!(error_code(&"x".repeat(10000)), "proof_failed");
    }
    #[test]
    fn stdin_accepts_only_fixed_close_or_quit_lines() {
        assert_eq!(control(b"close\n"), Some(false));
        assert_eq!(control(b"quit\n"), Some(true));
        for value in [
            b"close secret\n".as_slice(),
            b"quit\r\n",
            b"close",
            b"eval()\n",
        ] {
            assert_eq!(control(value), None);
        }
    }
}

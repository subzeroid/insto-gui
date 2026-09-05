//! Fixed developer proof controls; never compiled into ordinary builds.
use std::{
    io::{Read, Write},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::Manager;
pub const SCRIPT: &str = include_str!("proof_window.js");
#[derive(Default)]
pub struct ProofWindow {
    failed: AtomicBool,
    reported: AtomicBool,
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
pub fn start(app: &tauri::AppHandle) {
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
        tokio::time::sleep(Duration::from_secs(300)).await;
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

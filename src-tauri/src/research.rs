//! Export destinations can only originate in the native save panel.
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT: usize = 2 * 1024 * 1024;

/// Returns false only when the user dismisses the native save panel. The web
/// view supplies a suggested basename, never a destination path.
pub async fn export<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
    contents: String,
) -> Result<bool, &'static str> {
    validate(&filename, &contents)?;
    let extension = if filename.ends_with(".json") {
        "json"
    } else {
        "html"
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(filename)
        .add_filter(extension.to_uppercase(), &[extension])
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let destination = receiver
        .await
        .map_err(|_| "research_storage")?
        .map(|path| path.into_path().map_err(|_| "research_storage"))
        .transpose()?;
    tokio::task::spawn_blocking(move || selected(destination, &contents))
        .await
        .map_err(|_| "research_storage")?
}

fn validate(filename: &str, contents: &str) -> Result<(), &'static str> {
    if contents.len() > MAX_EXPORT {
        return Err("research_limit");
    }
    let stem = filename
        .strip_suffix(".html")
        .or_else(|| filename.strip_suffix(".json"))
        .ok_or("research_invalid")?;
    if stem.is_empty()
        || filename.starts_with('.')
        || filename.len() > 512
        || filename.chars().count() > 120
        || !filename
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
        || contents.contains('\0')
        || contents.is_empty()
    {
        return Err("research_invalid");
    }
    Ok(())
}

fn selected(path: Option<PathBuf>, contents: &str) -> Result<bool, &'static str> {
    match path {
        None => Ok(false),
        Some(path) => {
            write(&path, contents)?;
            Ok(true)
        }
    }
}

fn destination(path: &Path) -> Result<(), &'static str> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file()
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.nlink() == 1 =>
        {
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("research_storage"),
    }
}

fn write(path: &Path, contents: &str) -> Result<(), &'static str> {
    if !path.is_absolute() {
        return Err("research_invalid");
    }
    destination(path)?;
    // The selected name can differ from the suggestion; enforce the same
    // report extensions on the native result before creating any file.
    validate(
        path.file_name()
            .and_then(|value| value.to_str())
            .ok_or("research_invalid")?,
        contents,
    )?;
    let parent = path.parent().ok_or("research_storage")?;
    if !parent.is_dir() {
        return Err("research_storage");
    }
    let mut random = [0_u8; 16];
    if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
        return Err("research_storage");
    }
    let nonce = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let temporary = parent.join(format!(".insto-export-{nonce}.tmp"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)
            .map_err(|_| "research_storage")?;
        file.write_all(contents.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "research_storage")?;
        destination(path)?;
        fs::rename(&temporary, path).map_err(|_| "research_storage")?;
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "research_storage")
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancelled_save_is_distinct_from_a_written_export() {
        assert_eq!(selected(None, "anything"), Ok(false));
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("alice.json");
        assert_eq!(selected(Some(path.clone()), "{}"), Ok(true));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "{}");
    }

    #[test]
    fn accepts_only_bounded_utf8_reports_and_safe_suggested_names() {
        assert!(validate("alice-report.html", "<!doctype html>Здравствуйте").is_ok());
        assert!(validate("alice.json", "{\"ok\":true}").is_ok());
        for name in [
            "../outside.html",
            "/tmp/check.html",
            "check.txt",
            "check.exe",
            "check.HTML",
            "",
            ".html",
        ] {
            assert_eq!(validate(name, "ok"), Err("research_invalid"));
        }
        assert_eq!(
            validate("alice.html", &"x".repeat(2 * 1024 * 1024 + 1)),
            Err("research_limit")
        );
        assert_eq!(
            validate("alice.html", "bad\0bytes"),
            Err("research_invalid")
        );
    }

    #[test]
    fn export_writes_exact_bytes_and_replaces_an_existing_regular_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("alice.html");
        write(&path, "<!doctype html>Привет").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "<!doctype html>Привет"
        );
        write(&path, "replacement").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "replacement");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn export_refuses_symlink_destinations_and_keeps_original_bytes() {
        use std::os::unix::fs::{symlink, MetadataExt};
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original.html");
        std::fs::write(&original, "original").unwrap();
        let destination = directory.path().join("report.html");
        symlink(&original, &destination).unwrap();
        assert_eq!(write(&destination, "changed"), Err("research_storage"));
        assert_eq!(std::fs::read_to_string(original).unwrap(), "original");
        assert_eq!(write(directory.path(), "changed"), Err("research_storage"));
        std::fs::remove_file(destination).unwrap();
        let destination = directory.path().join("private.html");
        write(&destination, "saved").unwrap();
        assert_eq!(
            std::fs::metadata(destination).unwrap().mode() & 0o777,
            0o600
        );
    }
}

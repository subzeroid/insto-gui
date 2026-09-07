//! The desktop root's `desktop-home.json`: the only authority on whether the
//! current profile is the app's own or an adopted CLI home.
//!
//! The core writes this document when it binds the root to an external home
//! (`insto/desktop/profile.py:write_binding`) and removes it when the root goes
//! back to its own profile. Reading it here keeps the answer true across a
//! relaunch, which no in-memory flag can be.

use crate::protocol::{response_path_ok, strict_json};
use std::{
    ffi::CString,
    fs::File,
    io::Read,
    os::{fd::FromRawFd, unix::ffi::OsStrExt},
    path::Path,
};

/// The file the core writes beside the desktop root.
pub const BINDING_FILE: &str = "desktop-home.json";
/// The same read bound the core applies to it (`profile.py:_LIMIT`).
pub const MAX_BINDING_BYTES: u64 = 64 * 1024;
/// `insto/desktop/profile.py:_OWNER`.
const OWNER: &str = "insto-gui";
const BINDING_KEYS: [&str; 4] = ["schema_version", "managed_by", "uid", "home"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Binding {
    /// No binding document: the root manages its own `profile` directory.
    Own,
    /// The root is bound to this external home; its registration may be the
    /// user's own CLI service, so mutations need explicit confirmation.
    Adopted { home: String },
    /// A document exists but is not one this app may act on. Read-only.
    Unknown,
}

enum Document {
    Absent,
    Unreadable,
    Bytes(Vec<u8>),
}

fn read_document(path: &Path) -> Document {
    let Ok(raw) = CString::new(path.as_os_str().as_bytes()) else {
        return Document::Unreadable;
    };
    // O_NOFOLLOW refuses a symlinked binding outright, so a planted link cannot
    // make the app adopt a home the core never bound. O_NONBLOCK keeps a FIFO
    // dropped into the root from blocking the open.
    let descriptor = unsafe {
        libc::open(
            raw.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        // A root without the document — including a root that does not exist
        // yet — is the app's own profile; anything else is not a verdict.
        return match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ENOENT) => Document::Absent,
            _ => Document::Unreadable,
        };
    }
    let file = unsafe { File::from_raw_fd(descriptor) };
    let Ok(info) = file.metadata() else {
        return Document::Unreadable;
    };
    if !info.is_file() || info.len() > MAX_BINDING_BYTES {
        return Document::Unreadable;
    }
    let mut bytes = Vec::new();
    if file
        .take(MAX_BINDING_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_BINDING_BYTES
    {
        return Document::Unreadable;
    }
    Document::Bytes(bytes)
}

fn parse(bytes: &[u8]) -> Binding {
    // `strict_json` rejects duplicate keys, which a plain Value parse silently
    // collapses.
    let Ok(value) = strict_json(bytes) else {
        return Binding::Unknown;
    };
    let Some(object) = value.as_object() else {
        return Binding::Unknown;
    };
    if object.len() != BINDING_KEYS.len()
        || !BINDING_KEYS.iter().all(|key| object.contains_key(*key))
    {
        return Binding::Unknown;
    }
    let home = object["home"].as_str().unwrap_or_default();
    if object["schema_version"].as_u64() != Some(1)
        || object["managed_by"].as_str() != Some(OWNER)
        || object["uid"].as_u64() != Some(u64::from(unsafe { libc::geteuid() }))
        || !response_path_ok(home)
    {
        return Binding::Unknown;
    }
    Binding::Adopted {
        home: home.to_owned(),
    }
}

/// Reads `<root>/desktop-home.json`. It never writes, never follows a symlinked
/// binding and never fails: an unreadable or unexpected document is `Unknown`,
/// which every caller treats as read-only.
pub fn read_binding(root: &Path) -> Binding {
    match read_document(&root.join(BINDING_FILE)) {
        Document::Absent => Binding::Own,
        Document::Unreadable => Binding::Unknown,
        Document::Bytes(bytes) => parse(&bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn document(home: &str) -> String {
        format!(
            "{{\"schema_version\":1,\"managed_by\":\"insto-gui\",\"uid\":{},\"home\":\"{home}\"}}",
            unsafe { libc::geteuid() }
        )
    }
    fn write(root: &Path, body: &str) {
        std::fs::write(root.join(BINDING_FILE), body).unwrap();
    }

    #[test]
    fn an_absent_binding_is_the_apps_own_profile() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(read_binding(temp.path()), Binding::Own);
        // A root that does not exist yet has no binding either, and the read
        // creates nothing: this is the only file the host may never write.
        assert_eq!(
            read_binding(&temp.path().join("never-prepared")),
            Binding::Own
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_core_written_binding_names_the_adopted_home() {
        let temp = tempfile::tempdir().unwrap();
        write(temp.path(), &document("/Users/x/.insto"));
        assert_eq!(
            read_binding(temp.path()),
            Binding::Adopted {
                home: "/Users/x/.insto".into()
            }
        );
        // The core expands `~` before it writes the binding, so a legitimate home
        // can be longer than the 1024-byte request bound.
        let expanded = format!("/Users/x/{}/.insto", "d".repeat(1200));
        write(temp.path(), &document(&expanded));
        assert_eq!(
            read_binding(temp.path()),
            Binding::Adopted { home: expanded }
        );
    }

    #[test]
    fn every_other_document_is_unknown() {
        let temp = tempfile::tempdir().unwrap();
        let uid = unsafe { libc::geteuid() };
        let valid = document("/Users/x/.insto");
        let oversized_home = format!(
            "\"/{}\"",
            "a".repeat(crate::protocol::RESPONSE_PATH_LIMIT_BYTES)
        );
        for body in [
            // Another account's binding, left behind in a shared location.
            valid.replace(
                &format!("\"uid\":{uid}"),
                &format!("\"uid\":{}", uid.wrapping_add(1)),
            ),
            valid.replace("\"uid\":", "\"uid\":-"),
            // Another product's document, or a future schema of ours.
            valid.replace("\"managed_by\":\"insto-gui\"", "\"managed_by\":\"insto\""),
            valid.replace("\"schema_version\":1", "\"schema_version\":2"),
            valid.replace("\"schema_version\":1", "\"schema_version\":1.0"),
            valid.replace("\"schema_version\":1", "\"schema_version\":true"),
            // Exactly the four documented keys: no extra, no missing, no duplicate.
            valid.replace("{\"schema_version\"", "{\"extra\":0,\"schema_version\""),
            valid.replace(&format!("\"uid\":{uid},"), ""),
            valid.replace(
                "{\"schema_version\"",
                "{\"home\":\"/Users/x/.insto\",\"schema_version\"",
            ),
            // Not an object, not JSON, not there at all.
            "[]".into(),
            "{".into(),
            String::new(),
            // A home that is not an absolute, NUL-free path within PATH_MAX.
            valid.replace("\"/Users/x/.insto\"", "\".insto\""),
            valid.replace("\"/Users/x/.insto\"", "\"~/.insto\""),
            valid.replace("\"/Users/x/.insto\"", "\"\""),
            valid.replace("\"/Users/x/.insto\"", "\"/Users/x/\\u0000/.insto\""),
            valid.replace("\"/Users/x/.insto\"", "5"),
            valid.replace("\"/Users/x/.insto\"", &oversized_home),
        ] {
            write(temp.path(), &body);
            assert_eq!(read_binding(temp.path()), Binding::Unknown, "{body}");
        }
    }

    #[test]
    fn unsafe_files_are_unknown_and_never_followed() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let elsewhere = root.join("elsewhere.json");
        std::fs::write(&elsewhere, document("/Users/x/.insto")).unwrap();
        // A symlink to a perfectly valid document is still not our binding.
        std::os::unix::fs::symlink(&elsewhere, root.join(BINDING_FILE)).unwrap();
        assert_eq!(read_binding(root), Binding::Unknown);
        std::fs::remove_file(root.join(BINDING_FILE)).unwrap();
        // A directory where the document belongs opens but is not a file.
        std::fs::create_dir(root.join(BINDING_FILE)).unwrap();
        assert_eq!(read_binding(root), Binding::Unknown);
        std::fs::remove_dir(root.join(BINDING_FILE)).unwrap();
        // More than the core's own 64 KiB read bound.
        std::fs::write(
            root.join(BINDING_FILE),
            vec![b' '; MAX_BINDING_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(read_binding(root), Binding::Unknown);
        // Unreadable to this account. Root can read anything, so skip it there.
        if unsafe { libc::geteuid() } != 0 {
            write(root, &document("/Users/x/.insto"));
            std::fs::set_permissions(
                root.join(BINDING_FILE),
                std::fs::Permissions::from_mode(0o000),
            )
            .unwrap();
            assert_eq!(read_binding(root), Binding::Unknown);
            std::fs::set_permissions(
                root.join(BINDING_FILE),
                std::fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }
    }
}

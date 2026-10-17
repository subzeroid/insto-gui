//! Explicit, local saved checks. No provider requests are made by this module.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::fd::AsRawFd,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_CHECKS: usize = 100;
const MAX_CHECK_BYTES: usize = 256 * 1024;
const MAX_LIBRARY_BYTES: usize = 2 * 1024 * 1024;
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SaveInput {
    pub username: String,
    pub target_pk: String,
    pub captured_at: u64,
    pub profile: Value,
    pub activity: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SavedCheck {
    pub id: String,
    pub username: String,
    pub target_pk: String,
    pub captured_at: u64,
    pub saved_at: u64,
    pub profile: Value,
    pub activity: Option<Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Library {
    version: u8,
    scope: String,
    checks: Vec<SavedCheck>,
}

/// A missing library is an empty first-use library. Existing invalid data is
/// always an error; it is never silently discarded or replaced.
pub fn list(root: &Path, scope: &str) -> Result<Vec<SavedCheck>, &'static str> {
    let _lock = STORE_LOCK.lock().map_err(|_| "research_storage")?;
    let file = location(root, scope, false)?;
    Ok(read(&file, scope)?.checks)
}

pub fn save(root: &Path, scope: &str, mut input: SaveInput) -> Result<SavedCheck, &'static str> {
    validate(&mut input)?;
    let _lock = STORE_LOCK.lock().map_err(|_| "research_storage")?;
    let file = location(root, scope, true)?;
    let _file_lock = mutation_lock(&file)?;
    let mut library = read(&file, scope)?;
    if library.checks.len() >= MAX_CHECKS {
        return Err("research_limit");
    }
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "research_storage")?
        .as_secs()
        .max(library.checks.first().map_or(0, |check| check.saved_at));
    let mut id = random_id()?;
    while library.checks.iter().any(|check| check.id == id) {
        id = random_id()?;
    }
    let check = SavedCheck {
        id,
        username: input.username,
        target_pk: input.target_pk,
        captured_at: input.captured_at,
        saved_at,
        profile: input.profile,
        activity: input.activity,
    };
    if serde_json::to_vec(&check)
        .map_err(|_| "research_invalid")?
        .len()
        > MAX_CHECK_BYTES
    {
        return Err("research_limit");
    }
    library.checks.insert(0, check.clone());
    write(&file, &library)?;
    Ok(check)
}

pub fn delete(root: &Path, scope: &str, id: &str) -> Result<bool, &'static str> {
    if !crate::protocol::hex(id, 32) {
        return Err("research_invalid");
    }
    let _lock = STORE_LOCK.lock().map_err(|_| "research_storage")?;
    let file = location(root, scope, false)?;
    if !file.parent().is_some_and(Path::is_dir) {
        return Err("research_missing");
    }
    let _file_lock = mutation_lock(&file)?;
    let mut library = read(&file, scope)?;
    let index = library
        .checks
        .iter()
        .position(|check| check.id == id)
        .ok_or("research_missing")?;
    library.checks.remove(index);
    write(&file, &library)?;
    Ok(true)
}

fn validate(input: &mut SaveInput) -> Result<(), &'static str> {
    use crate::protocol::{Operation, Response, MAX_TIME, WINDOWS};
    if !crate::protocol::canonical_user(&input.username)
        || !crate::protocol::target_pk(&input.target_pk)
        || input.captured_at > MAX_TIME
        || serde_json::to_vec(input)
            .map_err(|_| "research_invalid")?
            .len()
            > MAX_CHECK_BYTES
    {
        return Err("research_invalid");
    }
    let decode = |value: &Value, kind: &str, operation: Operation| {
        let mut body = value.as_object().cloned().ok_or("research_invalid")?;
        if body.contains_key("kind") {
            return Err("research_invalid");
        }
        body.insert("kind".into(), json!(kind));
        let mut raw = serde_json::to_vec(
            &json!({"protocol_version":1,"request_id":"research","result":body}),
        )
        .map_err(|_| "research_invalid")?;
        raw.push(b'\n');
        crate::protocol::decode(&raw, "research", &operation).map_err(|_| "research_invalid")
    };
    match decode(
        &input.profile,
        "lookup_profile",
        Operation::LookupProfile {
            username: input.username.clone(),
        },
    )? {
        Response::LookupProfile(profile) if profile.target_pk == input.target_pk => {
            if input.activity.is_some()
                && matches!(profile.access, crate::protocol::Access::Private)
            {
                return Err("research_invalid");
            }
            input.profile = serde_json::to_value(profile).map_err(|_| "research_invalid")?;
        }
        _ => return Err("research_invalid"),
    }
    if let Some(activity) = &mut input.activity {
        let window = activity
            .get("window")
            .and_then(Value::as_u64)
            .and_then(|value| u8::try_from(value).ok())
            .filter(|value| WINDOWS.contains(value))
            .ok_or("research_invalid")?;
        match decode(
            activity,
            "lookup_activity",
            Operation::LookupActivity {
                target_pk: input.target_pk.clone(),
                window,
            },
        )? {
            Response::LookupActivity(validated) => {
                *activity = serde_json::to_value(validated).map_err(|_| "research_invalid")?
            }
            _ => return Err("research_invalid"),
        }
    }
    Ok(())
}

fn private(metadata: &fs::Metadata, directory: bool) -> bool {
    metadata.uid() == unsafe { libc::geteuid() }
        && metadata.mode() & 0o077 == 0
        && if directory {
            metadata.is_dir()
        } else {
            metadata.is_file() && metadata.nlink() == 1
        }
}

/// A stable sidecar coordinates the read/modify/rename cycle across launches.
/// Locking the data inode would stop protecting it after an atomic rename.
fn mutation_lock(path: &Path) -> Result<File, &'static str> {
    let path = path.with_extension("lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "research_storage")?;
    if !private(&file.metadata().map_err(|_| "research_storage")?, false) {
        return Err("research_storage");
    }
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(file);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::WouldBlock || Instant::now() >= deadline {
            return Err("research_storage");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn location(root: &Path, scope: &str, create: bool) -> Result<PathBuf, &'static str> {
    if scope.is_empty() || scope.len() > 4096 || scope.contains('\0') {
        return Err("research_scope");
    }
    if !root.is_absolute()
        || !private(
            &fs::symlink_metadata(root).map_err(|_| "research_storage")?,
            true,
        )
    {
        return Err("research_storage");
    }
    let directory = root.join("research-library");
    if create {
        match fs::DirBuilder::new().mode(0o700).create(&directory) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err("research_storage"),
        }
    }
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if private(&metadata, true) => (),
        Err(error) if !create && error.kind() == std::io::ErrorKind::NotFound => (),
        _ => return Err("research_storage"),
    }
    let digest = Sha256::digest(scope.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(directory.join(format!("{filename}.json")))
}

fn read(path: &Path, scope: &str) -> Result<Library, &'static str> {
    let mut file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // A dangling symlink is an unsafe file, not a first-use library.
            if fs::symlink_metadata(path).is_ok() {
                return Err("research_storage");
            }
            return Ok(Library {
                version: 1,
                scope: scope.into(),
                checks: Vec::new(),
            });
        }
        Err(_) => return Err("research_storage"),
    };
    let metadata = file.metadata().map_err(|_| "research_storage")?;
    if !private(&metadata, false) {
        return Err("research_storage");
    }
    if metadata.len() > MAX_LIBRARY_BYTES as u64 {
        return Err("research_corrupt");
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_LIBRARY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "research_storage")?;
    if bytes.len() > MAX_LIBRARY_BYTES {
        return Err("research_corrupt");
    }
    let mut library: Library = serde_json::from_slice(&bytes).map_err(|_| "research_corrupt")?;
    if library.version != 1 || library.scope != scope || library.checks.len() > MAX_CHECKS {
        return Err("research_corrupt");
    }
    let mut ids = HashSet::new();
    let mut previous = u64::MAX;
    for check in &mut library.checks {
        if !crate::protocol::hex(&check.id, 32)
            || !ids.insert(check.id.clone())
            || check.saved_at > crate::protocol::MAX_TIME
            || check.saved_at > previous
            || serde_json::to_vec(check)
                .map_err(|_| "research_corrupt")?
                .len()
                > MAX_CHECK_BYTES
        {
            return Err("research_corrupt");
        }
        previous = check.saved_at;
        let mut input = SaveInput {
            username: check.username.clone(),
            target_pk: check.target_pk.clone(),
            captured_at: check.captured_at,
            profile: check.profile.clone(),
            activity: check.activity.clone(),
        };
        validate(&mut input).map_err(|_| "research_corrupt")?;
        check.profile = input.profile;
        check.activity = input.activity;
    }
    Ok(library)
}

fn random_id() -> Result<String, &'static str> {
    let mut bytes = [0_u8; 16];
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return Err("research_storage");
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write(path: &Path, library: &Library) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(library).map_err(|_| "research_storage")?;
    if bytes.len() > MAX_LIBRARY_BYTES {
        return Err("research_limit");
    }
    let parent = path.parent().ok_or("research_storage")?;
    let temporary = parent.join(format!(".{}.tmp", random_id()?));
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)
            .map_err(|_| "research_storage")?;
        output
            .write_all(&bytes)
            .and_then(|_| output.sync_all())
            .map_err(|_| "research_storage")?;
        match fs::symlink_metadata(path) {
            Ok(metadata) if private(&metadata, false) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => return Err("research_storage"),
        }
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
    use serde_json::json;

    fn private_root() -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        root
    }

    fn library_file(root: &Path) -> PathBuf {
        std::fs::read_dir(root.join("research-library"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "json")
            })
            .unwrap()
    }

    fn input() -> SaveInput {
        SaveInput {
            username: "alice".into(),
            target_pk: "7".into(),
            captured_at: 1_700_000_000,
            profile: json!({"target_pk":"7","access":"public","fields":{},"unknown_fields":["username","full_name","biography","external_url","is_verified","is_business","is_private","follower_count","following_count","media_count","public_email","public_phone","business_category"],"quota_remaining":null}),
            activity: None,
        }
    }

    fn empty_activity() -> Value {
        json!({"target_pk":"7","window":12,"analyzed":0,
            "geo":{"geotagged":0,"anchor":null,"centroid":null,"radius_km":null,"places":[]},
            "timeline":{"hour_of_day":vec![0;24],"day_of_week":vec![0;7],"weekday_hours":vec![vec![0;24];7],"first_post_at":null,"last_post_at":null},
            "hashtags":[],"mentions":[],"locations":[],"likes":{"total":0,"average":0.0,"top_posts":[]},"quota_remaining":null})
    }

    #[test]
    fn refuses_activity_for_a_private_profile() {
        let root = private_root();
        let mut public = input();
        public.activity = Some(empty_activity());
        save(root.path(), "own:/home", public.clone()).unwrap();
        public.profile["access"] = json!("private");
        assert_eq!(
            save(root.path(), "own:/home", public).unwrap_err(),
            "research_invalid"
        );
    }

    #[test]
    fn cross_process_save_worker() {
        let Some(root) = std::env::var_os("INSTO_RESEARCH_TEST_CHILD_ROOT") else {
            return;
        };
        for _ in 0..12 {
            save(Path::new(&root), "own:/home", input()).unwrap();
        }
    }

    #[test]
    fn independent_processes_do_not_lose_explicit_saves() {
        use std::process::{Command, Stdio};
        let root = private_root();
        save(root.path(), "own:/home", input()).unwrap();
        let children = (0..4)
            .map(|_| {
                Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "research::tests::cross_process_save_worker",
                        "--nocapture",
                        "--test-threads=1",
                    ])
                    .env("INSTO_RESEARCH_TEST_CHILD_ROOT", root.path())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .unwrap()
            })
            .collect::<Vec<_>>();
        for child in children {
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        assert_eq!(list(root.path(), "own:/home").unwrap().len(), 49);
    }

    #[test]
    fn contended_mutation_lock_fails_within_a_bounded_time_without_data_loss() {
        let root = private_root();
        save(root.path(), "own:/home", input()).unwrap();
        let file = library_file(root.path());
        let original = std::fs::read(&file).unwrap();
        let held = mutation_lock(&file).unwrap();
        let started = Instant::now();
        assert_eq!(
            save(root.path(), "own:/home", input()).unwrap_err(),
            "research_storage"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(std::fs::read(&file).unwrap(), original);
        drop(held);
        assert!(save(root.path(), "own:/home", input()).is_ok());
    }

    #[test]
    fn library_byte_limit_preserves_existing_checks() {
        let root = private_root();
        let mut large = input();
        let values = [
            ("username", 255),
            ("full_name", 255),
            ("biography", 2048),
            ("external_url", 2048),
            ("public_email", 320),
            ("public_phone", 64),
            ("business_category", 255),
        ];
        large.profile["fields"] = json!(values
            .into_iter()
            .map(|(name, size)| (name, "🦀".repeat(size)))
            .collect::<std::collections::BTreeMap<_, _>>());
        large.profile["unknown_fields"] = json!([
            "is_verified",
            "is_business",
            "is_private",
            "follower_count",
            "following_count",
            "media_count"
        ]);
        let mut saved = 0;
        loop {
            match save(root.path(), "own:/home", large.clone()) {
                Ok(_) => saved += 1,
                Err(error) => {
                    assert_eq!(error, "research_limit");
                    break;
                }
            }
        }
        assert!(
            saved < MAX_CHECKS,
            "must reach the byte ceiling before the entry ceiling"
        );
        assert_eq!(list(root.path(), "own:/home").unwrap().len(), saved);
        assert!(
            std::fs::metadata(library_file(root.path())).unwrap().len() <= MAX_LIBRARY_BYTES as u64
        );
    }

    #[test]
    fn explicit_save_reopens_in_scope_and_deletes_only_exact_ids() {
        let root = private_root();
        assert!(list(root.path(), "own:/home").unwrap().is_empty());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        let first = save(root.path(), "own:/home", input()).unwrap();
        let second = save(root.path(), "own:/home", input()).unwrap();
        assert_eq!(first.id.len(), 32);
        assert_ne!(first.id, second.id);
        assert_eq!(
            list(root.path(), "own:/home")
                .unwrap()
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            vec![second.id.as_str(), first.id.as_str()]
        );
        assert!(list(root.path(), "adopted:/other").unwrap().is_empty());
        assert_eq!(
            delete(root.path(), "own:/home", "../outside"),
            Err("research_invalid")
        );
        assert_eq!(
            delete(root.path(), "own:/home", &"0".repeat(32)),
            Err("research_missing")
        );
        assert!(delete(root.path(), "own:/home", &first.id).unwrap());
        assert_eq!(list(root.path(), "own:/home").unwrap().len(), 1);
    }

    #[test]
    fn refuses_invalid_identity_unknown_fields_and_unbounded_data() {
        let root = private_root();
        let mut invalid = input();
        invalid.profile["target_pk"] = json!("8");
        assert_eq!(
            save(root.path(), "own:/home", invalid).unwrap_err(),
            "research_invalid"
        );
        let mut invalid = input();
        invalid.profile["html"] = json!("<script>arbitrary</script>");
        assert_eq!(
            save(root.path(), "own:/home", invalid).unwrap_err(),
            "research_invalid"
        );
        let mut invalid = input();
        invalid.captured_at = u64::MAX;
        assert_eq!(
            save(root.path(), "own:/home", invalid).unwrap_err(),
            "research_invalid"
        );
        let mut invalid = input();
        invalid.activity = Some(json!({"target_pk":"7","window":13}));
        assert_eq!(
            save(root.path(), "own:/home", invalid).unwrap_err(),
            "research_invalid"
        );
        assert_eq!(
            save(root.path(), "", input()).unwrap_err(),
            "research_scope"
        );
    }

    #[test]
    fn bounds_the_library_and_reports_corruption_without_overwriting() {
        let root = private_root();
        for _ in 0..100 {
            save(root.path(), "own:/home", input()).unwrap();
        }
        assert_eq!(
            save(root.path(), "own:/home", input()).unwrap_err(),
            "research_limit"
        );
        let file = library_file(root.path());
        std::fs::write(&file, b"{broken").unwrap();
        assert_eq!(
            list(root.path(), "own:/home").unwrap_err(),
            "research_corrupt"
        );
        assert_eq!(
            save(root.path(), "own:/home", input()).unwrap_err(),
            "research_corrupt"
        );
        assert_eq!(std::fs::read(file).unwrap(), b"{broken");
    }

    #[test]
    fn parallel_explicit_saves_preserve_every_check() {
        let root = private_root();
        let saves = (0..8)
            .map(|_| {
                let path = root.path().to_path_buf();
                std::thread::spawn(move || save(&path, "own:/home", input()).unwrap().id)
            })
            .collect::<Vec<_>>();
        let ids = saves
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), 8);
        let reopened = list(root.path(), "own:/home").unwrap();
        assert_eq!(
            reopened
                .iter()
                .map(|check| check.id.clone())
                .collect::<HashSet<_>>(),
            ids
        );
    }

    #[test]
    fn existing_protocol_invalid_checks_and_oversized_files_are_visible_errors() {
        let root = private_root();
        save(root.path(), "own:/home", input()).unwrap();
        let file = library_file(root.path());
        let mut library: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        library["checks"][0]["profile"]["target_pk"] = json!("8");
        std::fs::write(&file, serde_json::to_vec(&library).unwrap()).unwrap();
        assert_eq!(
            list(root.path(), "own:/home").unwrap_err(),
            "research_corrupt"
        );
        std::fs::write(&file, vec![b' '; MAX_LIBRARY_BYTES + 1]).unwrap();
        assert_eq!(
            list(root.path(), "own:/home").unwrap_err(),
            "research_corrupt"
        );
    }

    #[test]
    fn a_clock_rollback_keeps_saved_order_valid() {
        let root = private_root();
        save(root.path(), "own:/home", input()).unwrap();
        let file = library_file(root.path());
        let mut library: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        let future = library["checks"][0]["saved_at"].as_u64().unwrap() + 1000;
        library["checks"][0]["saved_at"] = json!(future);
        std::fs::write(&file, serde_json::to_vec(&library).unwrap()).unwrap();
        let saved = save(root.path(), "own:/home", input()).unwrap();
        assert!(saved.saved_at >= future);
        assert_eq!(list(root.path(), "own:/home").unwrap().len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_and_nonprivate_files() {
        use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
        let root = private_root();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), root.path().join("research-library")).unwrap();
        assert_eq!(
            save(root.path(), "own:/home", input()).unwrap_err(),
            "research_storage"
        );
        std::fs::remove_file(root.path().join("research-library")).unwrap();
        save(root.path(), "own:/home", input()).unwrap();
        let file = library_file(root.path());
        let metadata = std::fs::metadata(&file).unwrap();
        assert_eq!(metadata.mode() & 0o777, 0o600);
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            list(root.path(), "own:/home").unwrap_err(),
            "research_storage"
        );
        std::fs::remove_file(&file).unwrap();
        symlink(outside.path().join("not-present"), &file).unwrap();
        assert_eq!(
            save(root.path(), "own:/home", input()).unwrap_err(),
            "research_storage"
        );
    }
}

use super::*;
use std::os::unix::fs::PermissionsExt;

struct Fixture {
    _temp: tempfile::TempDir,
    bundle: PathBuf,
    root: PathBuf,
    home: PathBuf,
    id: String,
}
impl Fixture {
    fn new() -> Self {
        use serde_json::json;
        use sha2::{Digest, Sha256};
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let bundle = home.join("bundle");
        std::fs::create_dir_all(bundle.join("python/bin")).unwrap();
        std::fs::write(bundle.join("python/bin/python3"), b"hello").unwrap();
        for path in [
            &bundle,
            &bundle.join("python"),
            &bundle.join("python/bin"),
            &bundle.join("python/bin/python3"),
        ] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let python: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packaging/python-distributions.json"
        )))
        .unwrap();
        let arch = architecture();
        let mut value = json!({"manifest_version":1,"inputs":{
            "core_commit":"1abf3fbdea04d3da4e56ec9bec1090d7737a9727", "core_wheel_name":"insto-0.7.20-py3-none-any.whl",
            "core_wheel_sha256":"a".repeat(64),"requirements_sha256":"b".repeat(64),"build_constraints_sha256":"c".repeat(64),
            "uv_version":"uv 0.8.13","architecture":arch,"python_version":python["python_version"],"upstream_url":python["targets"][arch]["url"],"upstream_sha256":python["targets"][arch]["sha256"]},
            "files":[{"path":".","type":"directory","mode":493},{"path":"bin","type":"directory","mode":493},
            {"path":"bin/python3","type":"file","mode":493,"size":5,"sha256":format!("{:x}",Sha256::digest(b"hello"))}]});
        let id = format!("{:x}", Sha256::digest(serde_json::to_vec(&value).unwrap()));
        value["build_id"] = json!(id);
        std::fs::write(
            bundle.join("manifest.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        std::fs::set_permissions(
            bundle.join("manifest.json"),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let root = home.join("app");
        Self {
            _temp: temp,
            bundle,
            root,
            home,
            id,
        }
    }
    fn prepare(&self) -> Result<Candidate> {
        prepare(
            &self.bundle,
            &self.root,
            &self.home,
            Instant::now() + Duration::from_secs(5),
        )
    }
    fn script(&mut self, extra: &str, version: &str) {
        use sha2::{Digest, Sha256};
        let script=format!("#!/usr/bin/python3\nimport sys,json,os\nr=json.load(sys.stdin)\n{extra}\nprint(json.dumps(dict(protocol_version=1,request_id=r['request_id'],result=dict(core_version='{version}',schema_version_supported=2,capabilities=['hello','setup.inspect','settings.inspect','setup.configure','credentials.replace','service.start','service.stop','service.repair']))))\n");
        std::fs::write(self.bundle.join("python/bin/python3"), script.as_bytes()).unwrap();
        let path = self.bundle.join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["files"][2]["size"] = serde_json::json!(script.len());
        value["files"][2]["sha256"] =
            serde_json::json!(format!("{:x}", Sha256::digest(script.as_bytes())));
        value.as_object_mut().unwrap().remove("build_id");
        self.id = format!("{:x}", Sha256::digest(serde_json::to_vec(&value).unwrap()));
        value["build_id"] = serde_json::json!(self.id);
        std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }
}

#[test]
fn stage_is_private_until_finish_and_idempotent_existing_is_verified() {
    let fixture = Fixture::new();
    let candidate = fixture.prepare().unwrap();
    assert!(!fixture.root.join("runtimes").join(&fixture.id).exists());
    let result = finish(candidate).unwrap();
    assert_eq!(std::fs::read(result.python()).unwrap(), b"hello");
    assert_eq!(result.build_id(), fixture.id);
    finish(fixture.prepare().unwrap()).unwrap();
    std::fs::write(result.python(), b"wrong").unwrap();
    assert!(fixture.prepare().is_err());
}

#[test]
fn modified_stage_and_empty_existing_destination_fail_closed() {
    let fixture = Fixture::new();
    let candidate = fixture.prepare().unwrap();
    let stage = candidate.python();
    std::fs::write(&stage, b"wrong").unwrap();
    assert!(finish(candidate).is_err());
    assert!(stage.exists());
    let destination = fixture.root.join("runtimes").join(&fixture.id);
    std::fs::create_dir(&destination).unwrap();
    std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(fixture.prepare().is_err());
    assert!(destination.is_dir());
    assert_eq!(std::fs::read_dir(destination).unwrap().count(), 0);
}

#[test]
fn account_home_is_absolute_and_existing() {
    let home = account_home().unwrap();
    assert!(home.is_absolute());
    assert!(home.is_dir());
}

#[test]
fn lock_wait_obeys_shared_deadline_and_rejects_unsafe_mode() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().canonicalize().unwrap();
    let root = Dir::absolute(&path).unwrap();
    let _held = lock(&root, Instant::now() + Duration::from_secs(1)).unwrap();
    let start = Instant::now();
    assert!(matches!(
        lock(&root, start + Duration::from_millis(30)),
        Err(RuntimeError::Timeout)
    ));
    assert!(start.elapsed() < Duration::from_millis(200));
    std::fs::set_permissions(
        path.join("runtime.lock"),
        std::fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(matches!(
        lock(&root, Instant::now() + Duration::from_secs(1)),
        Err(RuntimeError::Ownership)
    ));
}

#[tokio::test]
async fn false_hello_and_mutation_during_hello_never_publish() {
    for (extra, version, expected) in [
        ("", "0.7.19", RuntimeError::Handshake),
        (
            "open(sys.argv[0],'a').write('# changed')",
            "0.7.20",
            RuntimeError::Integrity,
        ),
    ] {
        let mut fixture = Fixture::new();
        fixture.script(extra, version);
        assert_eq!(
            publish(&fixture.bundle, &fixture.root, &fixture.home)
                .await
                .err(),
            Some(expected)
        );
        assert!(!fixture.root.join("runtimes").join(&fixture.id).exists());
        assert!(std::fs::read_dir(fixture.root.join("runtimes"))
            .unwrap()
            .next()
            .is_some());
    }
}

#[tokio::test]
async fn hello_uses_remaining_transaction_deadline_and_drains_owned_child() {
    let mut fixture = Fixture::new();
    fixture.script(
        "open('child-pid','w').write(str(os.getpid()))\nimport time\ntime.sleep(30)",
        "0.7.20",
    );
    let start = Instant::now();
    let result = publish_until(
        fixture.bundle.clone(),
        fixture.root.clone(),
        fixture.home.clone(),
        start + Duration::from_secs(2),
    )
    .await;
    assert_eq!(result.err(), Some(RuntimeError::Timeout));
    assert!(start.elapsed() < Duration::from_secs(3));
    let pid: i32 = std::fs::read_to_string(fixture.root.join("child-pid"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert!(!fixture.root.join("runtimes").join(&fixture.id).exists());
}

#[tokio::test]
async fn concurrent_publishers_verify_and_reuse_one_build() {
    let mut fixture = Fixture::new();
    fixture.script("", "0.7.20");
    let (first, second) = tokio::join!(
        publish(&fixture.bundle, &fixture.root, &fixture.home),
        publish(&fixture.bundle, &fixture.root, &fixture.home)
    );
    assert_eq!(first.unwrap().python(), second.unwrap().python());
    assert_eq!(
        std::fs::read_dir(fixture.root.join("runtimes"))
            .unwrap()
            .count(),
        1
    );
    assert!(!fixture.root.join("profile.sqlite3").exists());
}

#[test]
fn atomic_publish_refuses_destination_created_after_prepare() {
    let fixture = Fixture::new();
    let candidate = fixture.prepare().unwrap();
    let stage = candidate.python();
    let destination = fixture.root.join("runtimes").join(&fixture.id);
    std::fs::create_dir(&destination).unwrap();
    assert!(finish(candidate).is_err());
    assert_eq!(std::fs::read_dir(destination).unwrap().count(), 0);
    assert!(stage.exists());
}

#[test]
fn symlink_sources_unsafe_roots_and_expired_deadline_are_rejected() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    assert!(matches!(
        prepare(
            &fixture.bundle,
            &fixture.root,
            &fixture.home,
            Instant::now()
        ),
        Err(RuntimeError::Timeout)
    ));
    symlink(&fixture.home, &fixture.root).unwrap();
    assert!(fixture.prepare().is_err());
    std::fs::remove_file(&fixture.root).unwrap();
    std::fs::create_dir(&fixture.root).unwrap();
    std::fs::set_permissions(&fixture.root, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(fixture.prepare().is_err());
    std::fs::set_permissions(&fixture.root, std::fs::Permissions::from_mode(0o700)).unwrap();
    let executable = fixture.bundle.join("python/bin/python3");
    std::fs::remove_file(&executable).unwrap();
    symlink("/bin/sh", &executable).unwrap();
    assert!(fixture.prepare().is_err());
}

#[test]
fn failed_copy_preserves_partial_stage_and_old_runtime() {
    let fixture = Fixture::new();
    std::fs::create_dir_all(fixture.root.join("runtimes/old")).unwrap();
    for path in [
        &fixture.root,
        &fixture.root.join("runtimes"),
        &fixture.root.join("runtimes/old"),
    ] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    std::fs::write(fixture.root.join("runtimes/old/sentinel"), b"unchanged").unwrap();
    super::super::inventory::FAIL_AFTER.with(|bytes| bytes.set(Some(2)));
    assert!(fixture.prepare().is_err());
    super::super::inventory::FAIL_AFTER.with(|bytes| bytes.set(None));
    assert!(!fixture.root.join("runtimes").join(&fixture.id).exists());
    assert_eq!(
        std::fs::read(fixture.root.join("runtimes/old/sentinel")).unwrap(),
        b"unchanged"
    );
    assert_eq!(
        std::fs::read_dir(fixture.root.join("runtimes"))
            .unwrap()
            .count(),
        2
    );
    finish(fixture.prepare().unwrap()).unwrap();
}

#[test]
fn swapped_ancestor_and_forged_destination_manifest_are_rejected() {
    let fixture = Fixture::new();
    let candidate = fixture.prepare().unwrap();
    let renamed = fixture.home.join("moved");
    std::fs::rename(&fixture.root, &renamed).unwrap();
    std::os::unix::fs::symlink(&renamed, &fixture.root).unwrap();
    assert!(finish(candidate).is_err());
    assert!(!renamed.join("runtimes").join(&fixture.id).exists());

    let fixture = Fixture::new();
    finish(fixture.prepare().unwrap()).unwrap();
    let manifest = fixture
        .root
        .join("runtimes")
        .join(&fixture.id)
        .join("manifest.json");
    std::fs::write(manifest, b"{}").unwrap();
    assert!(fixture.prepare().is_err());
}

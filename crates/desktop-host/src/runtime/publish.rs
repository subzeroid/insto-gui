use super::{
    filesystem::{check, metadata, same, Dir, Ownership},
    inventory,
    manifest::{Manifest, MAX_MANIFEST_BYTES},
    Result, RuntimeError,
};
use std::{
    ffi::{CStr, CString, OsStr},
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub struct PublishedRuntime {
    root: PathBuf,
    python: PathBuf,
    build_id: String,
}
impl PublishedRuntime {
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn python(&self) -> &Path {
        &self.python
    }
    pub fn build_id(&self) -> &str {
        &self.build_id
    }
}

/// Account database lookup deliberately ignores the inherited HOME environment.
pub fn account_home() -> Result<PathBuf> {
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        let mut record: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result = std::ptr::null_mut();
        let status = unsafe {
            libc::getpwuid_r(
                libc::getuid(),
                &mut record,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            )
        };
        if status == libc::ERANGE && buffer.len() < 1024 * 1024 {
            buffer.resize(buffer.len() * 2, 0);
            continue;
        }
        if status != 0 || result.is_null() || record.pw_dir.is_null() {
            return Err(RuntimeError::Ownership);
        }
        let bytes = unsafe { CStr::from_ptr(record.pw_dir) }.to_bytes();
        let home = PathBuf::from(OsStr::from_bytes(bytes));
        Dir::absolute(&home)?;
        return Ok(home);
    }
}

pub fn application_root(home: &Path) -> Result<PathBuf> {
    let parent = home.join("Library/Application Support");
    Dir::absolute(&parent)?;
    Ok(parent.join("insto-gui"))
}

fn architecture() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    }
}

fn lock(root: &Dir, deadline: Instant) -> Result<File> {
    check(deadline)?;
    let fd = loop {
        check(deadline)?;
        let fd = unsafe {
            libc::openat(
                root.0.as_raw_fd(),
                c"runtime.lock".as_ptr(),
                libc::O_RDWR
                    | libc::O_CREAT
                    | libc::O_NOFOLLOW
                    | libc::O_CLOEXEC
                    | libc::O_NONBLOCK,
                0o600,
            )
        };
        if fd >= 0 {
            break fd;
        }
        // APFS can report ENOENT while two O_CREAT opens race to create the
        // same new lock. Retry only that transient result within the deadline.
        if std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOENT) {
            return Err(RuntimeError::Ownership);
        }
        std::thread::sleep(Duration::from_millis(1));
    };
    let file = unsafe { File::from_raw_fd(fd) };
    let before = metadata(&file, false)?;
    if before.uid() != unsafe { libc::getuid() } || before.mode() & 0o7777 != 0o600 {
        return Err(RuntimeError::Ownership);
    }
    loop {
        check(deadline)?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            break;
        }
        let error = std::io::Error::last_os_error().raw_os_error();
        if error != Some(libc::EWOULDBLOCK) && error != Some(libc::EINTR) {
            return Err(RuntimeError::Storage);
        }
        std::thread::sleep(
            Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
    same(&before, &metadata(&file, false)?)?;
    same(&before, &metadata(&root.file("runtime.lock")?, false)?)?;
    Ok(file)
}

fn raw_manifest(bundle: &Dir, deadline: Instant, ownership: Ownership) -> Result<Vec<u8>> {
    let mut file = bundle.file("manifest.json")?;
    let before = ownership.metadata(&file, false)?;
    if before.size() > MAX_MANIFEST_BYTES as u64 {
        return Err(RuntimeError::Manifest);
    }
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        check(deadline)?;
        let count = file.read(&mut chunk).map_err(|_| RuntimeError::Storage)?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > MAX_MANIFEST_BYTES {
            return Err(RuntimeError::Manifest);
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    same(&before, &ownership.metadata(&file, false)?)?;
    Ok(bytes)
}

struct Candidate {
    _lock: File,
    root: PathBuf,
    home: PathBuf,
    bundle: PathBuf,
    runtimes: Dir,
    wrapper: Dir,
    manifest: Manifest,
    raw: Vec<u8>,
    name: String,
    existing: bool,
    deadline: Instant,
}
impl Candidate {
    fn python(&self) -> PathBuf {
        self.root
            .join("runtimes")
            .join(&self.name)
            .join("python/bin/python3")
    }
    fn verify(&self) -> Result<()> {
        check(self.deadline)?;
        let root = private_root(&self.root)?;
        same(
            &metadata(&self._lock, false)?,
            &metadata(&root.file("runtime.lock")?, false)?,
        )?;
        let runtimes = root.private("runtimes")?;
        same(
            &metadata(&self.runtimes.0, true)?,
            &metadata(&runtimes.0, true)?,
        )?;
        let wrapper = runtimes.private(&self.name)?;
        same(
            &metadata(&self.wrapper.0, true)?,
            &metadata(&wrapper.0, true)?,
        )?;
        let mut count = 0;
        wrapper.entries(|name| {
            check(self.deadline)?;
            if !matches!(name, "python" | "manifest.json") {
                return Err(RuntimeError::Integrity);
            }
            count += 1;
            Ok(())
        })?;
        if count != 2 {
            return Err(RuntimeError::Integrity);
        }
        // Destination metadata is never authoritative. Its exact bytes must
        // still match the bounded manifest read from the trusted bundle.
        if raw_manifest(&wrapper, self.deadline, Ownership::Destination)? != self.raw {
            return Err(RuntimeError::Integrity);
        }
        inventory::verify(
            &wrapper.child("python")?,
            &self.manifest.files,
            self.deadline,
            Ownership::Destination,
        )
    }
}
fn private_root(root: &Path) -> Result<Dir> {
    let parent = root.parent().ok_or(RuntimeError::Ownership)?;
    let name = root
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or(RuntimeError::Ownership)?;
    Dir::absolute(parent)?.private(name)
}
fn prepare(bundle: &Path, root: &Path, home: &Path, deadline: Instant) -> Result<Candidate> {
    check(deadline)?;
    Dir::absolute(home)?;
    let source = Dir::absolute(bundle)?;
    let raw = raw_manifest(&source, deadline, Ownership::Source)?;
    let manifest = Manifest::parse(&raw, architecture())?;
    let root_dir = private_root(root)?;
    let held = lock(&root_dir, deadline)?;
    let runtimes = root_dir.private("runtimes")?;
    inventory::verify(
        &source.child("python")?,
        &manifest.files,
        deadline,
        Ownership::Source,
    )?;
    let mut existing = false;
    runtimes.entries(|name| {
        check(deadline)?;
        if name == manifest.build_id {
            existing = true;
        }
        Ok(())
    })?;
    let name = if existing {
        manifest.build_id.clone()
    } else {
        let mut random = [0u8; 16];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err(RuntimeError::Storage);
        }
        format!(
            ".stage-{}",
            random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    };
    let wrapper = if existing {
        runtimes.private(&name)?
    } else {
        runtimes.exclusive_dir(&name)?
    };
    if !existing {
        let python = wrapper.exclusive_dir("python")?;
        inventory::copy(&source.child("python")?, &python, &manifest.files, deadline)?;
        let mut file = wrapper.create("manifest.json")?;
        file.write_all(&raw).map_err(|_| RuntimeError::Storage)?;
        file.sync_all().map_err(|_| RuntimeError::Storage)?;
        wrapper.sync()?;
        runtimes.sync()?;
        root_dir.sync()?;
    }
    let candidate = Candidate {
        _lock: held,
        root: root.into(),
        home: home.into(),
        bundle: bundle.into(),
        runtimes,
        wrapper,
        manifest,
        raw,
        name,
        existing,
        deadline,
    };
    candidate.verify()?;
    Ok(candidate)
}
fn finish(candidate: Candidate) -> Result<PublishedRuntime> {
    candidate.verify()?;
    let source = Dir::absolute(&candidate.bundle)?;
    if raw_manifest(&source, candidate.deadline, Ownership::Source)? != candidate.raw {
        return Err(RuntimeError::Integrity);
    }
    inventory::verify(
        &source.child("python")?,
        &candidate.manifest.files,
        candidate.deadline,
        Ownership::Source,
    )?;
    if !candidate.existing {
        check(candidate.deadline)?;
        let from = CString::new(candidate.name.as_str()).map_err(|_| RuntimeError::Storage)?;
        let to = CString::new(candidate.manifest.build_id.as_str())
            .map_err(|_| RuntimeError::Storage)?;
        // RENAME_EXCL is atomic even for an empty existing destination directory.
        if unsafe {
            libc::renameatx_np(
                candidate.runtimes.0.as_raw_fd(),
                from.as_ptr(),
                candidate.runtimes.0.as_raw_fd(),
                to.as_ptr(),
                libc::RENAME_EXCL,
            )
        } != 0
        {
            return Err(RuntimeError::Storage);
        }
        candidate.runtimes.sync()?;
    }
    check(candidate.deadline)?;
    let python = candidate
        .root
        .join("runtimes")
        .join(&candidate.manifest.build_id)
        .join("python/bin/python3");
    Ok(PublishedRuntime {
        root: candidate.root,
        python,
        build_id: candidate.manifest.build_id,
    })
}

/// Trusted native caller only: none of these paths are accepted through IPC.
/// The owned transaction survives cancellation of its caller until child cleanup.
pub async fn publish(bundle: &Path, root: &Path, home: &Path) -> Result<PublishedRuntime> {
    let (bundle, root, home) = (bundle.to_path_buf(), root.to_path_buf(), home.to_path_buf());
    let deadline = Instant::now() + Duration::from_secs(120);
    publish_until(bundle, root, home, deadline).await
}
async fn publish_until(
    bundle: PathBuf,
    root: PathBuf,
    home: PathBuf,
    deadline: Instant,
) -> Result<PublishedRuntime> {
    tokio::spawn(async move {
        let candidate =
            tokio::task::spawn_blocking(move || prepare(&bundle, &root, &home, deadline))
                .await
                .map_err(|_| RuntimeError::Storage)??;
        check(deadline)?;
        let launcher = crate::process::TrustedLauncher::new(
            &candidate.root,
            &candidate.python(),
            &candidate.home,
        )
        .map_err(|_| RuntimeError::Handshake)?;
        let owner = crate::owner::Owner::new(launcher);
        let hello = tokio::time::timeout_at(
            tokio::time::Instant::from_std(deadline),
            owner.execute(crate::Operation::Hello),
        )
        .await;
        owner.shutdown().await;
        match hello {
            Ok(Ok(crate::Response::Hello(_))) => (),
            Err(_) => return Err(RuntimeError::Timeout),
            _ => return Err(RuntimeError::Handshake),
        }
        tokio::task::spawn_blocking(move || finish(candidate))
            .await
            .map_err(|_| RuntimeError::Storage)?
    })
    .await
    .map_err(|_| RuntimeError::Storage)?
}

#[cfg(test)]
mod tests;

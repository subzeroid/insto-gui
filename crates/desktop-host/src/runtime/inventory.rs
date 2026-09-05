use super::{
    filesystem::{check, metadata, same, Dir},
    manifest::Entry,
    Result, RuntimeError,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, Permissions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    time::Instant,
};

type Index<'a> = BTreeMap<&'a str, BTreeMap<&'a str, &'a Entry>>;
#[cfg(test)]
thread_local! { pub(super) static FAIL_AFTER: std::cell::Cell<Option<usize>> = const {std::cell::Cell::new(None)}; }
fn write_chunk(file: &mut File, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(test)]
    if let Some(remaining) = FAIL_AFTER.with(|limit| limit.get()) {
        let count = remaining.min(bytes.len());
        file.write_all(&bytes[..count])?;
        FAIL_AFTER.with(|limit| limit.set(Some(remaining - count)));
        if count < bytes.len() {
            return Err(std::io::Error::from_raw_os_error(libc::ENOSPC));
        }
        return Ok(());
    }
    file.write_all(bytes)
}
fn index(entries: &[Entry]) -> Index<'_> {
    let mut result: Index<'_> = BTreeMap::new();
    for entry in entries.iter().skip(1) {
        let (parent, name) = entry.path().rsplit_once('/').unwrap_or((".", entry.path()));
        result.entry(parent).or_default().insert(name, entry);
    }
    result
}
fn stream(
    mut source: File,
    mut destination: Option<&mut File>,
    entry: &Entry,
    deadline: Instant,
) -> Result<()> {
    let Entry::File {
        mode, size, sha256, ..
    } = entry
    else {
        return Err(RuntimeError::Integrity);
    };
    let before = metadata(&source, false)?;
    if before.size() != *size || before.mode() & 0o7777 != *mode {
        return Err(RuntimeError::Integrity);
    }
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check(deadline)?;
        let count = source
            .read(&mut buffer)
            .map_err(|_| RuntimeError::Storage)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > *size {
            return Err(RuntimeError::Integrity);
        }
        hash.update(&buffer[..count]);
        if let Some(file) = destination.as_deref_mut() {
            write_chunk(file, &buffer[..count]).map_err(|_| RuntimeError::Storage)?;
        }
    }
    same(&before, &metadata(&source, false)?)?;
    if total != *size || format!("{:x}", hash.finalize()) != *sha256 {
        return Err(RuntimeError::Integrity);
    }
    if let Some(file) = destination {
        file.set_permissions(Permissions::from_mode(*mode))
            .map_err(|_| RuntimeError::Storage)?;
        file.sync_all().map_err(|_| RuntimeError::Storage)?;
    }
    check(deadline)
}
fn walk(
    source: &Dir,
    destination: Option<&Dir>,
    entry: &Entry,
    entries: &Index<'_>,
    deadline: Instant,
    depth: usize,
) -> Result<()> {
    check(deadline)?;
    if depth > 128 {
        return Err(RuntimeError::Manifest);
    }
    let before = metadata(&source.0, true)?;
    if before.mode() & 0o7777 != entry.mode() {
        return Err(RuntimeError::Integrity);
    }
    let expected = entries.get(entry.path());
    let mut seen = 0;
    source.entries(|name| {
        check(deadline)?;
        let child = expected
            .and_then(|map| map.get(name))
            .ok_or(RuntimeError::Integrity)?;
        seen += 1;
        match child {
            Entry::Directory { .. } => {
                let from = source.child(name)?;
                let to = destination.map(|dir| dir.exclusive_dir(name)).transpose()?;
                walk(&from, to.as_ref(), child, entries, deadline, depth + 1)?;
            }
            Entry::File { .. } => {
                let from = source.file(name)?;
                let mut to = destination.map(|dir| dir.create(name)).transpose()?;
                stream(from, to.as_mut(), child, deadline)?;
            }
        }
        Ok(())
    })?;
    if seen != expected.map_or(0, BTreeMap::len) {
        return Err(RuntimeError::Integrity);
    }
    same(&before, &metadata(&source.0, true)?)?;
    if let Some(dir) = destination {
        dir.0
            .set_permissions(Permissions::from_mode(entry.mode()))
            .map_err(|_| RuntimeError::Storage)?;
        dir.sync()?;
    }
    check(deadline)
}
pub(super) fn verify(root: &Dir, entries: &[Entry], deadline: Instant) -> Result<()> {
    let first = entries.first().ok_or(RuntimeError::Manifest)?;
    walk(root, None, first, &index(entries), deadline, 0)
}
pub(super) fn copy(
    source: &Dir,
    destination: &Dir,
    entries: &[Entry],
    deadline: Instant,
) -> Result<()> {
    let first = entries.first().ok_or(RuntimeError::Manifest)?;
    walk(
        source,
        Some(destination),
        first,
        &index(entries),
        deadline,
        0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn exact_inventory_copies_hashes_and_rejects_extra_missing_and_changed_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap();
        let root = Dir::absolute(&path).unwrap();
        let source = root.private("source").unwrap();
        std::fs::write(path.join("source/file"), b"hello").unwrap();
        std::fs::set_permissions(
            path.join("source/file"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        let entries = vec![
            Entry::Directory {
                path: ".".into(),
                mode: 0o700,
            },
            Entry::File {
                path: "file".into(),
                mode: 0o600,
                size: 5,
                sha256: format!("{:x}", Sha256::digest(b"hello")),
            },
        ];
        let deadline = Instant::now() + std::time::Duration::from_secs(2);
        assert!(verify(&source, &entries, deadline).is_ok());
        let dest = root.private("dest").unwrap();
        copy(&source, &dest, &entries, deadline).unwrap();
        verify(&dest, &entries, deadline).unwrap();
        std::fs::write(path.join("source/extra"), b"x").unwrap();
        assert!(verify(&source, &entries, deadline).is_err());
        std::fs::remove_file(path.join("source/extra")).unwrap();
        std::fs::write(path.join("source/file"), b"wrong").unwrap();
        assert!(verify(&source, &entries, deadline).is_err());
        std::fs::remove_file(path.join("source/file")).unwrap();
        assert!(verify(&source, &entries, deadline).is_err());
    }
}

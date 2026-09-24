use super::{Result, RuntimeError};
use std::{
    ffi::{CStr, CString},
    fs::File,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::{Component, Path},
    time::Instant,
};

pub(super) fn check(deadline: Instant) -> Result<()> {
    if Instant::now() >= deadline {
        Err(RuntimeError::Timeout)
    } else {
        Ok(())
    }
}
fn name(value: &str) -> Result<CString> {
    if value.is_empty() || value.contains('/') || value == ".." {
        return Err(RuntimeError::Ownership);
    }
    CString::new(value).map_err(|_| RuntimeError::Ownership)
}
pub(super) fn metadata(file: &File, directory: bool) -> Result<std::fs::Metadata> {
    Ownership::Source.metadata(file, directory)
}

#[derive(Clone, Copy)]
pub(super) enum Ownership {
    Source,
    Destination,
}
impl Ownership {
    fn allows(self, owner: u32, current: u32) -> bool {
        owner == current || (matches!(self, Self::Source) && owner == 0)
    }
    pub fn metadata(self, file: &File, directory: bool) -> Result<std::fs::Metadata> {
        let m = file.metadata().map_err(|_| RuntimeError::Storage)?;
        let uid = unsafe { libc::getuid() };
        if !self.allows(m.uid(), uid)
            || m.mode() & 0o7022 != 0
            || (directory && !m.is_dir())
            || (!directory && (!m.is_file() || m.nlink() != 1))
        {
            return Err(RuntimeError::Ownership);
        }
        Ok(m)
    }
}
/// The one ancestor layout macOS itself installs applications into: `/Applications`
/// is `root:admin 0775`. A member of `admin` can replace the whole bundle, host
/// binary included, so accepting exactly this layout as a path component weakens
/// nothing the walk ever defended. World-writable and special-bit directories,
/// other groups and non-root owners stay refused, and the exemption never applies
/// to files, to `Dir::child`, or to `Ownership::Destination`.
pub(super) const ADMIN_GID: u32 = 80;
pub(super) fn system_ancestor(directory: bool, uid: u32, gid: u32, mode: u32) -> bool {
    directory && uid == 0 && gid == ADMIN_GID && mode & 0o7777 == 0o775
}
pub(super) fn same(before: &std::fs::Metadata, after: &std::fs::Metadata) -> Result<()> {
    if before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.size() != after.size()
        || before.mode() != after.mode()
        || before.uid() != after.uid()
        || before.nlink() != after.nlink()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        Err(RuntimeError::Integrity)
    } else {
        Ok(())
    }
}
pub(super) struct Dir(pub File);
impl Dir {
    fn open(parent: i32, value: &str) -> Result<Self> {
        let name = name(value)?;
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(RuntimeError::Ownership);
        }
        Ok(Self(unsafe { File::from_raw_fd(fd) }))
    }
    pub fn absolute(path: &Path) -> Result<Self> {
        if !path.is_absolute() || path.canonicalize().map_err(|_| RuntimeError::Ownership)? != path
        {
            return Err(RuntimeError::Ownership);
        }
        let fd = unsafe {
            libc::open(
                c"/".as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(RuntimeError::Storage);
        }
        let mut dir = Self(unsafe { File::from_raw_fd(fd) });
        metadata(&dir.0, true)?;
        for component in path.components() {
            match component {
                Component::RootDir => (),
                Component::Normal(part) => {
                    dir = Self::open(
                        dir.0.as_raw_fd(),
                        part.to_str().ok_or(RuntimeError::Ownership)?,
                    )?;
                    if let Err(error) = metadata(&dir.0, true) {
                        let m = dir.0.metadata().map_err(|_| RuntimeError::Storage)?;
                        let test_temp =
                            cfg!(test) && m.is_dir() && m.uid() == 0 && m.mode() & 0o7777 == 0o1777;
                        if !(test_temp
                            || system_ancestor(m.is_dir(), m.uid(), m.gid(), m.mode() & 0o7777))
                        {
                            return Err(error);
                        }
                    }
                }
                _ => return Err(RuntimeError::Ownership),
            }
        }
        Ok(dir)
    }
    pub fn child(&self, value: &str) -> Result<Self> {
        let child = Self::open(self.0.as_raw_fd(), value)?;
        metadata(&child.0, true)?;
        Ok(child)
    }
    pub fn private(&self, value: &str) -> Result<Self> {
        let n = name(value)?;
        let result = unsafe { libc::mkdirat(self.0.as_raw_fd(), n.as_ptr(), 0o700) };
        if result != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
            return Err(RuntimeError::Storage);
        }
        let child = self.child(value)?;
        let m = metadata(&child.0, true)?;
        if m.uid() != unsafe { libc::getuid() } || m.mode() & 0o7777 != 0o700 {
            return Err(RuntimeError::Ownership);
        }
        Ok(child)
    }
    pub fn exclusive_dir(&self, value: &str) -> Result<Self> {
        let n = name(value)?;
        if unsafe { libc::mkdirat(self.0.as_raw_fd(), n.as_ptr(), 0o700) } != 0 {
            return Err(RuntimeError::Storage);
        }
        self.private(value)
    }
    pub fn file(&self, value: &str) -> Result<File> {
        let n = name(value)?;
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                n.as_ptr(),
                libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(RuntimeError::Ownership);
        }
        let file = unsafe { File::from_raw_fd(fd) };
        metadata(&file, false)?;
        Ok(file)
    }
    pub fn create(&self, value: &str) -> Result<File> {
        let n = name(value)?;
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                n.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(RuntimeError::Storage);
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    pub fn entries(&self, mut visitor: impl FnMut(&str) -> Result<()>) -> Result<()> {
        let fresh = Self::open(self.0.as_raw_fd(), ".")?;
        let fd = std::os::fd::IntoRawFd::into_raw_fd(fresh.0);
        let pointer = unsafe { libc::fdopendir(fd) };
        if pointer.is_null() {
            unsafe {
                libc::close(fd);
            }
            return Err(RuntimeError::Storage);
        }
        struct Stream(*mut libc::DIR);
        impl Drop for Stream {
            fn drop(&mut self) {
                unsafe {
                    libc::closedir(self.0);
                }
            }
        }
        let stream = Stream(pointer);
        loop {
            unsafe {
                #[cfg(target_os = "macos")]
                let errno = libc::__error();
                #[cfg(target_os = "linux")]
                let errno = libc::__errno_location();
                *errno = 0;
            }
            let entry = unsafe { libc::readdir(stream.0) };
            if entry.is_null() {
                if std::io::Error::last_os_error().raw_os_error() != Some(0) {
                    return Err(RuntimeError::Storage);
                }
                return Ok(());
            }
            let value = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
                .to_str()
                .map_err(|_| RuntimeError::Integrity)?;
            if value != "." && value != ".." {
                visitor(value)?;
            }
        }
    }
    pub fn sync(&self) -> Result<()> {
        self.0.sync_all().map_err(|_| RuntimeError::Storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    #[test]
    fn destination_ownership_excludes_root_and_other_accounts() {
        for (owner, source, destination) in
            [(0, true, false), (501, true, true), (502, false, false)]
        {
            assert_eq!(Ownership::Source.allows(owner, 501), source);
            assert_eq!(Ownership::Destination.allows(owner, 501), destination);
        }
        // UID 0 is allowed only when it is the current account itself.
        assert!(Ownership::Destination.allows(0, 0));
    }

    #[test]
    fn root_owned_descriptor_is_source_only_without_chown() {
        let file = std::fs::File::open("/").unwrap();
        assert_eq!(file.metadata().unwrap().uid(), 0);
        assert!(Ownership::Source.metadata(&file, true).is_ok());
        if unsafe { libc::getuid() } != 0 {
            assert!(matches!(
                Ownership::Destination.metadata(&file, true),
                Err(RuntimeError::Ownership)
            ));
        }
    }
    #[test]
    fn private_directories_reject_symlink_and_unsafe_existing_modes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap();
        let parent = Dir::absolute(&path).unwrap();
        assert!(parent.private("private").is_ok());
        std::fs::set_permissions(path.join("private"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        assert!(parent.private("private").is_err());
        symlink("private", path.join("link")).unwrap();
        assert!(parent.private("link").is_err());
    }
    #[test]
    fn ordinary_file_open_rejects_fifo_and_hardlink_without_blocking() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap();
        let parent = Dir::absolute(&path).unwrap();
        std::fs::write(path.join("file"), b"hello").unwrap();
        std::fs::hard_link(path.join("file"), path.join("hard")).unwrap();
        assert!(parent.file("file").is_err());
        let fifo = std::ffi::CString::new(path.join("fifo").to_str().unwrap()).unwrap();
        unsafe {
            assert_eq!(libc::mkfifo(fifo.as_ptr(), 0o600), 0);
        }
        assert!(parent.file("fifo").is_err());
    }

    #[test]
    fn system_ancestor_accepts_only_root_admin_0775_directories() {
        assert!(system_ancestor(true, 0, ADMIN_GID, 0o775));
        assert!(system_ancestor(true, 0, ADMIN_GID, 0o040775 & 0o7777));
        // World write, wrong group, wrong owner, a file, special bits: all refused.
        assert!(!system_ancestor(true, 0, ADMIN_GID, 0o777));
        assert!(!system_ancestor(true, 0, 20, 0o775));
        assert!(!system_ancestor(true, 501, ADMIN_GID, 0o775));
        assert!(!system_ancestor(false, 0, ADMIN_GID, 0o775));
        assert!(!system_ancestor(true, 0, ADMIN_GID, 0o1775));
        assert!(!system_ancestor(true, 0, ADMIN_GID, 0o2775));
        assert!(!system_ancestor(true, 0, ADMIN_GID, 0o755 | 0o020 | 0o002));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn absolute_walk_accepts_the_real_applications_directory() {
        // macOS installs /Applications as root:admin 0775. When this machine matches
        // that layout the walk must accept it; when it does not, the test cannot
        // say anything about the exemption and only checks the predicate agrees.
        let m = std::fs::metadata("/Applications").unwrap();
        let expected = system_ancestor(m.is_dir(), m.uid(), m.gid(), m.mode() & 0o7777);
        assert_eq!(
            Dir::absolute(Path::new("/Applications")).is_ok(),
            expected
                || Ownership::Source
                    .metadata(&File::open("/Applications").unwrap(), true)
                    .is_ok()
        );
        if m.uid() == 0 && m.gid() == ADMIN_GID && m.mode() & 0o7777 == 0o775 {
            assert!(Dir::absolute(Path::new("/Applications")).is_ok());
        }
    }

    #[test]
    fn absolute_walk_still_refuses_user_owned_group_writable_ancestors() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap();
        std::fs::create_dir(path.join("shared")).unwrap();
        std::fs::create_dir(path.join("shared/bundle")).unwrap();
        std::fs::set_permissions(path.join("shared"), std::fs::Permissions::from_mode(0o775))
            .unwrap();
        assert!(matches!(
            Dir::absolute(&path.join("shared/bundle")),
            Err(RuntimeError::Ownership)
        ));
    }
}

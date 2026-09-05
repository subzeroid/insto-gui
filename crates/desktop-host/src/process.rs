use crate::{HostError, Operation, Response};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::{sync::watch, time::Instant};
#[derive(Clone)]
pub struct TrustedLauncher {
    root: PathBuf,
    python: PathBuf,
    home: PathBuf,
    #[cfg(test)]
    pub(crate) force_cleanup_timeout: bool,
}
impl TrustedLauncher {
    pub fn new(root: &Path, python: &Path, home: &Path) -> Result<Self, HostError> {
        for path in [root, python, home] {
            if !path.is_absolute() || path.canonicalize().map_err(|_| HostError::Launcher)? != path
            {
                return Err(HostError::Launcher);
            }
        }
        if !root.is_dir() || !home.is_dir() || !python.is_file() {
            return Err(HostError::Launcher);
        }
        Ok(Self {
            root: root.into(),
            python: python.into(),
            home: home.into(),
            #[cfg(test)]
            force_cleanup_timeout: false,
        })
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Policy {
    pub read: Duration,
    pub mutation: Duration,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            read: Duration::from_secs(10),
            mutation: Duration::from_secs(120),
        }
    }
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
async fn observe_exit(child: &mut tokio::process::Child) -> Result<bool, HostError> {
    let pid = child.id().ok_or(HostError::Transport)?;
    loop {
        {
            // SAFETY: zero-initialized siginfo is valid output storage; WNOWAIT
            // observes only our child and preserves its PID until explicit cleanup.
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let result = unsafe {
                libc::waitid(
                    libc::P_PID,
                    pid,
                    &mut info,
                    libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                )
            };
            if result == -1 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(HostError::Transport);
            }
            // SAFETY: successful waitid initialized these child-status fields.
            if unsafe { info.si_pid() } != 0 {
                return Ok(info.si_code == libc::CLD_EXITED && unsafe { info.si_status() } == 0);
            }
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
// The group is created by Command for this child only. It never contains a
// service discovered through logs or a profile. Drop also covers task abortion.
struct Group(i32);
impl Drop for Group {
    fn drop(&mut self) {
        // SAFETY: a positive child PID is the group ID assigned at spawn.
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}
async fn bounded(
    mut pipe: impl AsyncRead + Unpin,
    limit: usize,
    retain: bool,
) -> Result<Vec<u8>, HostError> {
    let mut result = Vec::new();
    let mut total = 0usize;
    let mut chunk = [0u8; 8192];
    loop {
        let n = pipe
            .read(&mut chunk)
            .await
            .map_err(|_| HostError::Transport)?;
        if n == 0 {
            return Ok(result);
        }
        total += n;
        if total > limit {
            return Err(HostError::Transport);
        }
        if retain {
            result.extend_from_slice(&chunk[..n]);
        }
    }
}
pub(crate) async fn run(
    launcher: &TrustedLauncher,
    op: Operation,
    deadline: Instant,
    mut cancel: watch::Receiver<bool>,
) -> Result<Response, HostError> {
    let mutation = op.is_mutation();
    let fail = || {
        if mutation {
            HostError::OutcomeUnknown
        } else {
            HostError::Transport
        }
    };
    let id = format!(
        "host-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    );
    let request = op.request(&id)?;
    if !mutation && *cancel.borrow() {
        return Err(fail());
    }
    let mut command = tokio::process::Command::new(&launcher.python);
    command
        .args(["-I", "-B", "-m", "insto.desktop"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .env("HOME", &launcher.home)
        .env("INSTO_DESKTOP_ROOT", &launcher.root)
        .current_dir(&launcher.root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        // Group owns cancellation; Child must not signal a PID after a failed
        // reap could have made that PID available for reuse.
        .kill_on_drop(false);
    let mut child = command.spawn().map_err(|_| fail())?;
    let group = Group(child.id().ok_or_else(fail)? as i32);
    let mut stdin = child.stdin.take().ok_or_else(fail)?;
    let stdout = child.stdout.take().ok_or_else(fail)?;
    let stderr = child.stderr.take().ok_or_else(fail)?;
    let result = {
        let work = async {
            let write = async move {
                stdin
                    .write_all(&request)
                    .await
                    .map_err(|_| HostError::Transport)?;
                stdin.shutdown().await.map_err(|_| HostError::Transport)?;
                drop(stdin);
                Ok::<_, HostError>(())
            };
            let wait = observe_exit(&mut child);
            let (_, out, _, status) = tokio::try_join!(
                write,
                bounded(stdout, crate::protocol::MAX_RESPONSE, true),
                bounded(stderr, 64 * 1024, false),
                wait
            )?;
            if !status {
                return Err(HostError::Transport);
            }
            crate::protocol::decode(&out, &id, &op)
        };
        tokio::select! {
            result=work => result,
            _=tokio::time::sleep_until(deadline) => Err(HostError::Transport),
            _=cancel.changed(), if !mutation => Err(HostError::Transport),
        }
    };
    // Kill all owned descendants even if the immediate child already exited.
    // Dropping the read futures above closes held pipes; cleanup cannot hang on
    // a descendant that inherited stdout/stderr.
    drop(group);
    #[cfg(test)]
    let force_timeout = launcher.force_cleanup_timeout;
    #[cfg(not(test))]
    let force_timeout = false;
    let confirmed = !force_timeout
        && matches!(
            tokio::time::timeout(Duration::from_millis(500), child.wait()).await,
            Ok(Ok(_))
        );
    if !confirmed {
        // Quarantine the exact child handle, without retaining pipes, request,
        // or credentials. No further group signals occur after the reap begins.
        tokio::spawn(async move {
            loop {
                if child.wait().await.is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
        return Err(HostError::CleanupUnconfirmed);
    }
    result.map_err(|_| fail())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    // Keep fixture startup scheduling out of deliberately short deadline tests.
    pub(crate) static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    pub(crate) struct Fixture {
        pub _dir: tempfile::TempDir,
        pub launcher: TrustedLauncher,
    }
    impl Fixture {
        pub fn new(body: &str) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().canonicalize().unwrap();
            let python = root.join("python");
            static PYTHON: std::sync::OnceLock<String> = std::sync::OnceLock::new();
            let interpreter = PYTHON.get_or_init(|| {
                let output = std::process::Command::new("/usr/bin/python3")
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
                    .args(["-I", "-B", "-c", "import sys; print(sys.executable)"])
                    .output()
                    .unwrap();
                assert!(output.status.success());
                String::from_utf8(output.stdout).unwrap().trim().into()
            });
            let script = format!("#!{interpreter}\nimport os,sys,json,time,subprocess\n{body}\n");
            std::fs::write(&python, script).unwrap();
            std::fs::set_permissions(&python, std::fs::Permissions::from_mode(0o700)).unwrap();
            let launcher = TrustedLauncher::new(&root, &python, &root).unwrap();
            Self {
                _dir: dir,
                launcher,
            }
        }
    }
    pub(crate) const RESPOND: &str = "r=json.load(sys.stdin)\nprofile=dict(configured=False,status='unconfigured',desired_service=None,service_running=False,quota_remaining=None,quota_checked_at=None,revision=None)\nprint(json.dumps(dict(protocol_version=1,request_id=r['request_id'],result=profile)),flush=True)";
    async fn invoke(body: &str, mutation: bool) -> Result<Response, HostError> {
        let fixture = Fixture::new(body);
        let (_tx, rx) = watch::channel(false);
        run(
            &fixture.launcher,
            if mutation {
                Operation::ServiceStart
            } else {
                Operation::SetupInspect
            },
            Instant::now() + Duration::from_secs(3),
            rx,
        )
        .await
    }
    #[tokio::test]
    async fn eof_and_fixed_argv_clean_environment() {
        let _lock = FIXTURE_LOCK.lock().await;
        let body=format!("assert sys.argv[1:]==['-I','-B','-m','insto.desktop']\nassert set(os.environ)<=set(['PATH','LANG','LC_ALL','HOME','INSTO_DESKTOP_ROOT','__CF_USER_TEXT_ENCODING'])\nassert os.environ['PATH']=='/usr/bin:/bin:/usr/sbin:/sbin'\nassert os.environ['HOME']==os.environ['INSTO_DESKTOP_ROOT']\n{RESPOND}");
        assert!(invoke(&body, false).await.is_ok());
    }
    #[tokio::test]
    async fn failure_modes_are_bounded_and_mutations_unknown() {
        let _lock = FIXTURE_LOCK.lock().await;
        let cases = [
            format!("{RESPOND}\nsys.exit(2)"),
            format!("{RESPOND}\ntime.sleep(30)"),
            "print('{',flush=True)".into(),
            format!("{RESPOND}\nprint('{{}}')"),
            "sys.stdout.write('s'*2200000);sys.stdout.flush();time.sleep(30)".into(),
            "sys.stderr.write('SECRET_SENTINEL'*10000);sys.stderr.flush();time.sleep(30)".into(),
            "time.sleep(30)".into(),
            format!("subprocess.Popen(['/bin/sleep','30'])\n{RESPOND}"),
        ];
        for body in cases {
            let start = Instant::now();
            assert_eq!(
                invoke(&body, false).await.unwrap_err(),
                HostError::Transport
            );
            assert!(start.elapsed() < Duration::from_secs(4));
            assert_eq!(
                invoke(&body, true).await.unwrap_err(),
                HostError::OutcomeUnknown
            );
        }
    }
    #[test]
    fn launcher_requires_canonical_absolute_inputs() {
        assert!(TrustedLauncher::new(
            Path::new("relative"),
            Path::new("relative"),
            Path::new("relative")
        )
        .is_err());
    }
    #[tokio::test]
    async fn inherited_pipe_descendants_are_killed_and_child_reaped() {
        let _lock = FIXTURE_LOCK.lock().await;
        let fixture=Fixture::new(&format!("open('child','w').write(str(os.getpid()))\np=subprocess.Popen(['/bin/sleep','30'])\nopen('grandchild','w').write(str(p.pid))\n{RESPOND}"));
        let (_tx, rx) = watch::channel(false);
        assert_eq!(
            run(
                &fixture.launcher,
                Operation::SetupInspect,
                Instant::now() + Duration::from_secs(3),
                rx
            )
            .await
            .unwrap_err(),
            HostError::Transport
        );
        for name in ["child", "grandchild"] {
            let pid: i32 = std::fs::read_to_string(fixture._dir.path().join(name))
                .unwrap()
                .parse()
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                // SAFETY: signal 0 only checks existence of this fixture PID.
                if unsafe { libc::kill(pid, 0) } == -1 {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "owned fixture process still exists"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    }
    #[tokio::test]
    async fn stream_overflow_is_immediate_not_deadline_capture() {
        let _lock = FIXTURE_LOCK.lock().await;
        for stream in ["stdout", "stderr"] {
            let fixture=Fixture::new(&format!("sys.{stream}.write('SECRET_SENTINEL'*200000)\nsys.{stream}.flush()\ntime.sleep(30)"));
            let (_tx, rx) = watch::channel(false);
            let start = Instant::now();
            let result = run(
                &fixture.launcher,
                Operation::CredentialsReplace {
                    token: "TOKEN_SENTINEL".into(),
                },
                start + Duration::from_secs(5),
                rx,
            )
            .await;
            assert_eq!(result.unwrap_err(), HostError::OutcomeUnknown);
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }
    #[tokio::test]
    async fn simultaneous_stderr_stdout_and_stdin_close_do_not_deadlock() {
        let _lock = FIXTURE_LOCK.lock().await;
        let body=format!("sys.stderr.write('e'*65536);sys.stderr.flush()\nsys.stdout.write(' '*100000);sys.stdout.flush()\n{RESPOND}");
        assert!(invoke(&body, false).await.is_ok());
    }
    #[tokio::test]
    async fn exit_observation_retains_pid_until_group_cleanup() {
        let _lock = FIXTURE_LOCK.lock().await;
        let mut child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id().unwrap() as i32;
        assert!(observe_exit(&mut child).await.unwrap());
        let mut status = 0;
        // SAFETY: waitpid addresses the exact fixture child, testing that exit
        // observation left it waitable and its PID unavailable for reuse.
        assert_eq!(
            unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) },
            pid
        );
    }
}

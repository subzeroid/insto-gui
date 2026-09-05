use crate::{
    process::{Policy, TrustedLauncher},
    HostError, Operation, Response,
};
use std::sync::{Arc, Mutex};
use tokio::sync::{oneshot, watch, Notify};
use tokio::time::Instant;
struct State {
    closed: bool,
    reads: usize,
    mutations: usize,
}
pub struct Owner {
    launcher: TrustedLauncher,
    policy: Policy,
    state: Mutex<State>,
    cancel: watch::Sender<bool>,
    changed: Notify,
}
struct Admission {
    owner: Arc<Owner>,
    mutation: bool,
}
impl Drop for Admission {
    fn drop(&mut self) {
        let mut state = self.owner.state.lock().unwrap_or_else(|e| e.into_inner());
        if self.mutation {
            state.mutations -= 1;
        } else {
            state.reads -= 1;
        }
        self.owner.changed.notify_waiters();
    }
}
impl Owner {
    pub fn new(launcher: TrustedLauncher) -> Arc<Self> {
        Self::with_policy(launcher, Policy::default())
    }
    fn with_policy(launcher: TrustedLauncher, policy: Policy) -> Arc<Self> {
        let (cancel, _) = watch::channel(false);
        Arc::new(Self {
            launcher,
            policy,
            state: Mutex::new(State {
                closed: false,
                reads: 0,
                mutations: 0,
            }),
            cancel,
            changed: Notify::new(),
        })
    }
    /// Admission happens on first poll. Once admitted, the owner retains the
    /// operation until supervision completes even if the invoke future is dropped.
    pub async fn execute(self: &Arc<Self>, operation: Operation) -> Result<Response, HostError> {
        let mutation = operation.is_mutation();
        let deadline = Instant::now()
            + if mutation {
                self.policy.mutation
            } else {
                self.policy.read
            };
        let admission = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.closed {
                return Err(HostError::Closed);
            }
            if (mutation && state.mutations == 1) || (!mutation && state.reads == 2) {
                return Err(HostError::Busy);
            }
            if mutation {
                state.mutations += 1;
            } else {
                state.reads += 1;
            }
            Admission {
                owner: self.clone(),
                mutation,
            }
        };
        let (tx, rx) = oneshot::channel();
        tokio::spawn(async move {
            let mut result = crate::process::run(
                &admission.owner.launcher,
                operation,
                deadline,
                admission.owner.cancel.subscribe(),
            )
            .await;
            if matches!(result, Err(HostError::CleanupUnconfirmed)) {
                {
                    let mut state = admission
                        .owner
                        .state
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    state.closed = true;
                    admission.owner.cancel.send_replace(true);
                }
                result = Err(if mutation {
                    HostError::OutcomeUnknown
                } else {
                    HostError::Transport
                });
            }
            drop(admission);
            let _ = tx.send(result);
        });
        rx.await.unwrap_or(Err(if mutation {
            HostError::OutcomeUnknown
        } else {
            HostError::Transport
        }))
    }
    /// Synchronously reject new work and cancel reads. UI close handlers call
    /// this before scheduling the asynchronous drain; accepted mutations keep
    /// their original deadlines and remain owned until supervision completes.
    pub fn close_admission(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.closed = true;
        self.cancel.send_replace(true);
    }
    /// Close admission, cancel reads, and drain accepted mutations to their
    /// original deadlines. This never requests a service stop or replays work.
    pub async fn shutdown(&self) {
        self.close_admission();
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            {
                let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                if state.reads + state.mutations == 0 {
                    return;
                }
            }
            changed.await;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::tests::{Fixture, RESPOND};
    use std::time::Duration;
    use tokio::time::Instant;
    fn owner(fixture: &Fixture) -> Arc<Owner> {
        Owner::with_policy(
            fixture.launcher.clone(),
            Policy {
                read: Duration::from_secs(2),
                mutation: Duration::from_secs(2),
            },
        )
    }
    async fn started(fixture: &Fixture) {
        let deadline = Instant::now() + Duration::from_secs(1);
        while !fixture._dir.path().join("started").exists() {
            assert!(Instant::now() < deadline, "fixture never started");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    #[tokio::test]
    async fn synchronous_close_blocks_an_unpolled_invoke_before_async_drain() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let fixture = Fixture::new(&format!("open('started','w').close()\n{RESPOND}"));
        let owner = owner(&fixture);
        let request = owner.execute(Operation::ServiceStart);
        owner.close_admission();
        owner.close_admission();
        assert_eq!(request.await.unwrap_err(), HostError::Closed);
        owner.shutdown().await;
        assert!(!fixture._dir.path().join("started").exists());
    }
    #[tokio::test]
    async fn two_reads_and_one_mutation_fail_busy_without_queue() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new(&format!(
            "open('started','w').close()\ntime.sleep(.3)\n{RESPOND}"
        ));
        let owner = owner(&f);
        let read1 = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::SetupInspect).await }
        });
        let read2 = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::SettingsInspect).await }
        });
        let mutation = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceStart).await }
        });
        started(&f).await;
        assert_eq!(
            owner.execute(Operation::Hello).await.unwrap_err(),
            HostError::Busy
        );
        assert_eq!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        assert!(read1.await.unwrap().is_ok());
        assert!(read2.await.unwrap().is_ok());
        assert!(mutation.await.unwrap().is_ok());
    }
    #[tokio::test]
    async fn cancelled_caller_retains_mutation_and_shutdown_drains_it() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new(&format!(
            "open('started','w').close()\ntime.sleep(.3)\nopen('completed','w').close()\n{RESPOND}"
        ));
        let owner = owner(&f);
        let call = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceStart).await }
        });
        started(&f).await;
        call.abort();
        let _ = call.await;
        assert_eq!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        owner.shutdown().await;
        assert!(f._dir.path().join("completed").exists());
        assert_eq!(
            owner.execute(Operation::SetupInspect).await.unwrap_err(),
            HostError::Closed
        );
    }
    #[tokio::test]
    async fn shutdown_cancels_reads_and_blocks_new_work() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new("open('started','w').close()\ntime.sleep(30)");
        let owner = owner(&f);
        let mut call = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::SetupInspect).await }
        });
        tokio::select! { _=started(&f)=>{}, result=&mut call=>panic!("child ended before ready: {result:?}") }
        let start = Instant::now();
        owner.shutdown().await;
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(call.await.unwrap().unwrap_err(), HostError::Transport);
        assert_eq!(
            owner.execute(Operation::ServiceStart).await.unwrap_err(),
            HostError::Closed
        );
    }
    #[tokio::test]
    async fn shutdown_preserves_original_mutation_deadline_and_never_replays() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new("open('started','a').write('1')\ntime.sleep(30)");
        let owner = Owner::with_policy(
            f.launcher.clone(),
            Policy {
                read: Duration::from_millis(400),
                mutation: Duration::from_millis(600),
            },
        );
        let call = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceRepair).await }
        });
        started(&f).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let start = Instant::now();
        owner.shutdown().await;
        assert!(start.elapsed() < Duration::from_millis(500));
        assert_eq!(call.await.unwrap().unwrap_err(), HostError::OutcomeUnknown);
        assert_eq!(
            std::fs::read_to_string(f._dir.path().join("started")).unwrap(),
            "1"
        );
    }
    #[tokio::test]
    async fn invalid_token_releases_admission_without_spawning() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new(RESPOND);
        let owner = owner(&f);
        assert_eq!(
            owner
                .execute(Operation::SetupConfigure {
                    token: "bad".into()
                })
                .await
                .unwrap_err(),
            HostError::InvalidToken
        );
        assert!(owner.execute(Operation::ServiceStart).await.is_ok());
        owner.shutdown().await;
    }
    #[tokio::test]
    async fn unconfirmed_cleanup_poison_closes_owner_and_never_reports_success() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let mut f = Fixture::new(RESPOND);
        f.launcher.force_cleanup_timeout = true;
        let owner = owner(&f);
        assert_eq!(
            owner.execute(Operation::ServiceStart).await.unwrap_err(),
            HostError::OutcomeUnknown
        );
        assert_eq!(
            owner.execute(Operation::SetupInspect).await.unwrap_err(),
            HostError::Closed
        );
        owner.shutdown().await;
    }
}

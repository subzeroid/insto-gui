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
            + match operation.budget() {
                crate::protocol::Budget::Read => self.policy.read,
                crate::protocol::Budget::LocalMutation => self.policy.local_mutation,
                crate::protocol::Budget::ServiceMutation => self.policy.mutation,
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
                read: Duration::from_secs(10),
                local_mutation: Duration::from_secs(10),
                mutation: Duration::from_secs(10),
            },
        )
    }
    async fn started(fixture: &Fixture, marker: &str) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !fixture._dir.path().join(marker).exists() {
            assert!(Instant::now() < deadline, "fixture never started: {marker}");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    async fn ready(
        fixture: &Fixture,
        marker: &str,
        call: &mut tokio::task::JoinHandle<Result<Response, HostError>>,
    ) {
        tokio::select! {
            _ = started(fixture, marker) => {},
            result = call => panic!("child ended before ready ({marker}): {result:?}"),
        }
    }
    fn gated_response() -> String {
        let response = RESPOND.strip_prefix("r=json.load(sys.stdin)\n").unwrap();
        format!(
            "r=json.load(sys.stdin)\nopen('started-'+r['operation'],'w').close()\nwhile not os.path.exists('release'): time.sleep(.005)\nopen('completed','w').close()\n{response}"
        )
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
        let f = Fixture::new(&gated_response());
        let owner = owner(&f);
        let mut read1 = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::SetupInspect).await }
        });
        let mut read2 = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::SettingsInspect).await }
        });
        let mut mutation = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceStart).await }
        });
        ready(&f, "started-setup.inspect", &mut read1).await;
        ready(&f, "started-settings.inspect", &mut read2).await;
        ready(&f, "started-service.start", &mut mutation).await;
        assert_eq!(
            owner.execute(Operation::Hello).await.unwrap_err(),
            HostError::Busy
        );
        assert_eq!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        std::fs::write(f._dir.path().join("release"), "").unwrap();
        assert!(read1.await.unwrap().is_ok());
        assert!(read2.await.unwrap().is_ok());
        assert!(mutation.await.unwrap().is_ok());
    }
    #[tokio::test]
    async fn cancelled_caller_retains_mutation_and_shutdown_drains_it() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::new(&gated_response());
        let owner = owner(&f);
        let mut call = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceStart).await }
        });
        ready(&f, "started-service.start", &mut call).await;
        // Deliberately delay the caller beyond the old fixture's 300 ms sleep.
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(
            !f._dir.path().join("completed").exists(),
            "mutation completed before explicit fixture release"
        );
        call.abort();
        let _ = call.await;
        assert_eq!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        let shutdown = owner.shutdown();
        tokio::pin!(shutdown);
        // Poll the actual drain while the accepted mutation is still blocked.
        std::future::poll_fn(|cx| {
            use std::future::Future;
            assert!(shutdown.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert!(!f._dir.path().join("completed").exists());
        std::fs::write(f._dir.path().join("release"), "").unwrap();
        tokio::time::timeout(Duration::from_secs(5), shutdown)
            .await
            .expect("shutdown did not drain the released mutation");
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
        ready(&f, "started", &mut call).await;
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
        let f = Fixture::shell("printf 1 >> started\nsleep 30");
        const MUTATION: Duration = Duration::from_secs(3);
        let owner = Owner::with_policy(
            f.launcher.clone(),
            Policy {
                read: Duration::from_secs(2),
                local_mutation: MUTATION,
                mutation: MUTATION,
            },
        );
        // The accepted mutation's deadline starts on its first poll, at or after
        // this instant; anchoring the drain assertion here keeps it independent
        // of how long the child took to start.
        let accepted = Instant::now();
        let mut call = tokio::spawn({
            let o = owner.clone();
            async move { o.execute(Operation::ServiceRepair).await }
        });
        ready(&f, "started", &mut call).await;
        tokio::time::sleep(MUTATION / 2).await;
        owner.shutdown().await;
        // Draining honours the original deadline instead of restarting the
        // clock at shutdown, which would end this at 1.5 * MUTATION; the
        // quarter budget here is slack for scheduling, not for a second clock.
        assert!(accepted.elapsed() < MUTATION + MUTATION / 4);
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
    #[tokio::test]
    async fn local_mutation_uses_its_own_deadline_not_the_read_or_service_budget() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        // Nothing here waits for the child: the deadline under test is shorter
        // than a loaded machine's process startup, so observing a started child
        // first would race the very deadline the test is about to assert on.
        let f = Fixture::shell("sleep 120");
        let owner = Owner::with_policy(
            f.launcher.clone(),
            Policy {
                read: Duration::from_secs(120),
                local_mutation: Duration::from_millis(400),
                mutation: Duration::from_secs(120),
            },
        );
        let start = Instant::now();
        assert_eq!(
            owner
                .execute(Operation::WatchesAdd {
                    user: "alice".into(),
                    interval_seconds: None,
                })
                .await
                .unwrap_err(),
            HostError::OutcomeUnknown
        );
        // Only the local-mutation budget can have ended this: the child sleeps
        // for two minutes and the other two budgets are just as long.
        assert!(start.elapsed() < Duration::from_secs(20));
        owner.shutdown().await;
    }
    #[tokio::test]
    async fn a_local_mutation_holds_the_single_mutation_slot() {
        let _lock = crate::process::tests::FIXTURE_LOCK.lock().await;
        let f = Fixture::shell(": > started\nwhile [ ! -e release ]; do sleep .02; done");
        // Ten-second budgets: the slot, not a deadline, is what is under test,
        // so the child stays alive however long a loaded machine takes to start it.
        let owner = owner(&f);
        let mut call = tokio::spawn({
            let o = owner.clone();
            async move {
                o.execute(Operation::WatchesAdd {
                    user: "alice".into(),
                    interval_seconds: None,
                })
                .await
            }
        });
        ready(&f, "started", &mut call).await;
        assert_eq!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        std::fs::write(f._dir.path().join("release"), "").unwrap();
        // The fixture answers nothing, so the call itself fails; what this test
        // watches is the slot, which the finished local mutation must release.
        assert!(call.await.unwrap().is_err());
        assert_ne!(
            owner.execute(Operation::ServiceStop).await.unwrap_err(),
            HostError::Busy
        );
        owner.shutdown().await;
    }
}

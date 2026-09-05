use std::{
    future::Future,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

type Outcome<T> = Result<Arc<T>, &'static str>;
type Pending<T> = watch::Receiver<Option<Outcome<T>>>;
struct Inner<T> {
    closed: bool,
    pending: Option<Pending<T>>,
}
pub struct Initialization<T> {
    inner: Mutex<Inner<T>>,
}
impl<T: Send + Sync + 'static> Initialization<T> {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                closed: false,
                pending: None,
            }),
        }
    }
    pub fn close(&self) -> bool {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let first = !state.closed;
        state.closed = true;
        first
    }
    pub fn is_closed(&self) -> bool {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).closed
    }
    pub async fn prepare<F, Fut>(&self, initialize: F) -> Outcome<T>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Outcome<T>> + Send + 'static,
    {
        let pending = {
            let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if state.closed {
                return Err("closed");
            }
            if state
                .pending
                .as_ref()
                .is_some_and(|rx| matches!(*rx.borrow(), Some(Err(_))))
            {
                state.pending = None;
            }
            state
                .pending
                .get_or_insert_with(|| {
                    let (tx, rx) = watch::channel(None);
                    tauri::async_runtime::spawn(async move {
                        tx.send_replace(Some(initialize().await));
                    });
                    rx
                })
                .clone()
        };
        Self::wait(pending).await
    }
    async fn wait(mut pending: Pending<T>) -> Outcome<T> {
        loop {
            if let Some(result) = pending.borrow_and_update().clone() {
                return result;
            }
            if pending.changed().await.is_err() {
                return Err("runtime_storage");
            }
        }
    }
    pub async fn drain(&self) -> Option<Outcome<T>> {
        let pending = self
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .clone();
        match pending {
            Some(pending) => Some(Self::wait(pending).await),
            None => None,
        }
    }
    pub fn ready(&self) -> Outcome<T> {
        let state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.closed {
            return Err("closed");
        }
        match &state.pending {
            None => Err("runtime_handshake"),
            Some(pending) => pending.borrow().clone().unwrap_or(Err("busy")),
        }
    }
    pub fn completed(&self) -> Option<Outcome<T>> {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .as_ref()
            .and_then(|pending| pending.borrow().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn caches_one_initialization_and_close_rejects_new_work() {
        let gate = Initialization::<usize>::new();
        let calls = Arc::new(AtomicUsize::new(0));
        for _ in 0..2 {
            let calls = calls.clone();
            assert_eq!(
                *gate
                    .prepare(move || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(7))
                    })
                    .await
                    .unwrap(),
                7
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(gate.close());
        assert!(!gate.close());
        assert_eq!(
            gate.prepare(|| async { panic!("must not initialize") })
                .await
                .unwrap_err(),
            "closed"
        );
        assert_eq!(*gate.drain().await.unwrap().unwrap(), 7);
    }
    #[tokio::test]
    async fn cancellation_does_not_drop_initialization_and_close_drains_it() {
        let gate = Arc::new(Initialization::<usize>::new());
        let (started, waiting) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let call = tokio::spawn({
            let gate = gate.clone();
            async move {
                gate.prepare(|| async {
                    started.send(()).unwrap();
                    released.await.unwrap();
                    Ok(Arc::new(9))
                })
                .await
            }
        });
        waiting.await.unwrap();
        assert_eq!(gate.ready().unwrap_err(), "busy");
        call.abort();
        gate.close();
        let drain = tokio::spawn({
            let gate = gate.clone();
            async move { gate.drain().await }
        });
        tokio::task::yield_now().await;
        assert!(!drain.is_finished());
        release.send(()).unwrap();
        assert_eq!(*drain.await.unwrap().unwrap().unwrap(), 9);
    }
    #[tokio::test]
    async fn explicit_prepare_retries_completed_failure() {
        let gate = Initialization::<usize>::new();
        assert_eq!(
            gate.prepare(|| async { Err("runtime_storage") })
                .await
                .unwrap_err(),
            "runtime_storage"
        );
        assert_eq!(
            *gate.prepare(|| async { Ok(Arc::new(3)) }).await.unwrap(),
            3
        );
    }
}

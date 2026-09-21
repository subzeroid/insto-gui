use crate::HostError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const MAX_REQUEST: usize = 64 * 1024;
pub const MAX_RESPONSE: usize = 2 * 1024 * 1024;
pub const MAX_TIME: u64 = 253_402_300_799;
pub const MAX_SAFE: u64 = 9_007_199_254_740_991;
pub const CORE_VERSION: &str = "0.7.22";
pub const CAPABILITIES: [&str; 25] = [
    "hello",
    "setup.inspect",
    "setup.configure",
    "settings.inspect",
    "credentials.replace",
    "service.start",
    "service.stop",
    "service.repair",
    "overview",
    "watches.list",
    "watches.add",
    "watches.update",
    "watches.pause",
    "watches.resume",
    "watches.remove",
    "snapshots.targets",
    "snapshots.list",
    "snapshots.compare",
    "snapshots.read",
    "changes.list",
    "service.inspect",
    "service.migrate",
    "service.uninstall",
    "home.inspect",
    "home.select",
];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Budget {
    Read,
    LocalMutation,
    ServiceMutation,
}
pub enum Operation {
    Hello,
    SetupInspect,
    SettingsInspect,
    SetupConfigure {
        token: String,
    },
    CredentialsReplace {
        token: String,
    },
    ServiceStart,
    ServiceStop,
    ServiceRepair,
    Overview,
    WatchesList {
        limit: Option<u8>,
        cursor: Option<String>,
    },
    WatchesAdd {
        user: String,
        interval_seconds: Option<u32>,
    },
    WatchesUpdate {
        user: String,
        revision: String,
        interval_seconds: u32,
    },
    WatchesPause {
        user: String,
        revision: String,
    },
    WatchesResume {
        user: String,
        revision: String,
    },
    WatchesRemove {
        user: String,
        revision: String,
    },
    SnapshotsTargets {
        username: String,
        limit: Option<u8>,
        cursor: Option<String>,
    },
    SnapshotsList {
        target_pk: String,
        limit: Option<u8>,
        cursor: Option<String>,
    },
    SnapshotsCompare {
        target_pk: String,
        older_id: String,
        newer_id: String,
    },
    SnapshotsRead {
        target_pk: String,
        snapshot_id: String,
    },
    ChangesList {
        target_pk: Option<String>,
        limit: Option<u8>,
        cursor: Option<String>,
    },
    ServiceInspect,
    ServiceMigrate,
    ServiceUninstall,
    HomeInspect {
        path: String,
    },
    HomeSelect {
        path: Option<String>,
    },
}
impl std::fmt::Debug for Operation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum Response {
    Hello(Hello),
    Profile(Profile),
    Overview(Overview),
    WatchPage(WatchPage),
    Watch(Watch),
    Removed(Removed),
    HistoryPage(HistoryPage),
    Comparison(Comparison),
    SnapshotFields(SnapshotFields),
    ServiceInspection(ServiceInspection),
    HomeInspection(HomeInspection),
    Error(SafeError),
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Hello {
    pub core_version: String,
    pub schema_version_supported: u64,
    pub capabilities: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Unconfigured,
    RecoveryRequired,
    QuotaExhausted,
    Running,
    Stopped,
    ServiceError,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesiredService {
    Running,
    Stopped,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub configured: bool,
    pub status: Status,
    pub desired_service: Option<DesiredService>,
    pub service_running: bool,
    pub quota_remaining: Option<u64>,
    pub quota_checked_at: Option<u64>,
    pub revision: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WatchStatus {
    Active,
    Paused,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Watch {
    pub user: String,
    pub status: WatchStatus,
    pub interval_seconds: u64,
    pub last_ok: Option<u64>,
    pub waiting_first_check: bool,
    pub has_error: bool,
    pub consecutive_errors: u64,
    pub revision: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WatchPage {
    #[serde(deserialize_with = "watches")]
    pub items: Vec<Watch>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceState {
    Running,
    Stopped,
    Unknown,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Overview {
    pub configured: bool,
    pub desired_service: Option<DesiredService>,
    pub service_state: ServiceState,
    pub quota_remaining: Option<u64>,
    pub quota_checked_at: Option<u64>,
    #[serde(deserialize_with = "watches")]
    pub watches: Vec<Watch>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Removed {
    pub removed_user: String,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Registration {
    None,
    Owned,
    Unknown,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Interpreter {
    Current,
    Other,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Settings {
    Matching,
    Different,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigState {
    Ok,
    Missing,
    Invalid,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    Hikerapi,
    Aiograpi,
    Fake,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseState {
    Ok,
    Missing,
    SchemaMismatch,
    Unreadable,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessState {
    Running,
    Stopped,
    Unknown,
}
// The four verdicts `insto/desktop/home.py:_reason` can return. A fifth word is
// a protocol violation, not a verdict the GUI may render.
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    HomeInvalid,
    HomeBackendUnsupported,
    SchemaMismatch,
    StorageError,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceInspection {
    pub registration: Registration,
    pub interpreter: Option<Interpreter>,
    pub interpreter_exists: Option<bool>,
    pub loaded: Option<bool>,
    pub settings: Option<Settings>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HomeInspection {
    pub path: String,
    pub exists: bool,
    pub private: bool,
    pub config: ConfigState,
    pub backend: Option<Backend>,
    pub database: DatabaseState,
    pub registration: Registration,
    pub interpreter: Option<Interpreter>,
    pub loaded: Option<bool>,
    pub process: ProcessState,
    pub adoptable: bool,
    pub reason: Option<Reason>,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub id: String,
    pub target_pk: String,
    pub captured_at: u64,
}
#[derive(Debug, Serialize, Clone)]
#[serde(untagged)]
pub enum ChangeValue {
    Null,
    Bool(bool),
    Integer(u64),
    Text(String),
}
#[derive(Debug, Serialize)]
pub struct Change {
    pub field: String,
    pub old: ChangeValue,
    pub new: ChangeValue,
}
#[derive(Debug, Serialize)]
pub struct Comparison {
    pub older: Snapshot,
    pub newer: Snapshot,
    pub changes: Vec<Change>,
    pub unknown_fields: Vec<String>,
}
// `snapshots.read`: one saved snapshot's tracked values. The names, the value
// typing and the `avatar`/`banner` stored-hash treatment are exactly the ones
// `snapshots.compare` reports in its change values, so one formatter serves both.
// A `BTreeMap` re-emits the object with sorted keys; the core's declaration order
// survives only in `unknown_fields`, which the window renders as a list.
#[derive(Debug, Serialize)]
pub struct SnapshotFields {
    pub snapshot: Snapshot,
    pub fields: std::collections::BTreeMap<String, ChangeValue>,
    pub unknown_fields: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    HistoryCorrupt,
    HistoryOversized,
    HistoryIdentityUnknown,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HistoryItem {
    Target {
        target_pk: String,
        snapshot: Snapshot,
    },
    Snapshot {
        snapshot: Snapshot,
    },
    Baseline {
        snapshot: Snapshot,
    },
    Comparison {
        older: Snapshot,
        newer: Snapshot,
        changes: Vec<Change>,
        unknown_fields: Vec<String>,
    },
    Incomplete {
        older: Snapshot,
        newer: Snapshot,
        changes: Vec<Change>,
        unknown_fields: Vec<String>,
    },
    Diagnostic {
        snapshot: Snapshot,
        code: DiagnosticCode,
    },
}
#[derive(Debug, Serialize)]
pub struct HistoryPage {
    pub items: Vec<HistoryItem>,
    pub next_cursor: Option<String>,
    pub scan_complete: bool,
    pub scanned: u64,
}
#[derive(Debug, Serialize)]
pub struct SafeError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}
pub(crate) fn canonical_user(value: &str) -> bool {
    (1..=255).contains(&value.len())
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_')
}
fn decimal(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit())
}
pub(crate) fn target_pk(value: &str) -> bool {
    decimal(value, 64)
}
pub(crate) fn snapshot_id(value: &str) -> bool {
    decimal(value, 19) && value.parse::<i64>().is_ok()
}
pub(crate) fn hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn base64url(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub(crate) fn watch_cursor(value: &str) -> bool {
    (4..=512).contains(&value.len()) && value.starts_with("w1.") && base64url(&value[3..])
}
pub(crate) fn history_cursor(value: &str) -> bool {
    (1..=1024).contains(&value.len()) && base64url(value)
}
pub const PATH_LIMIT_BYTES: usize = 1024;
pub const RESPONSE_PATH_LIMIT_BYTES: usize = 4096;
// The shape the core accepts before it resolves a home: an absolute path or
// `~`/`~/…`. Canonicality, symlinks, ownership and privacy stay the core's
// verdict; a `..` segment can never survive the core's normalization, so it is
// refused here instead of travelling to the bridge.
fn home_path_ok(value: &str) -> bool {
    (value.starts_with('/') || value == "~" || value.starts_with("~/"))
        && (1..=PATH_LIMIT_BYTES).contains(&value.len())
        && !value.contains('\0')
        && !value.split('/').any(|segment| segment == "..")
}
// The shape the core answers with: it expands `~` and normalizes before it
// reports, so a valid response path is always absolute and may be longer than
// the request bound. PATH_MAX is the only ceiling left.
pub(crate) fn response_path_ok(value: &str) -> bool {
    value.starts_with('/')
        && (1..=RESPONSE_PATH_LIMIT_BYTES).contains(&value.len())
        && !value.contains('\0')
}
fn limit_ok(value: Option<u8>) -> bool {
    value.is_none_or(|n| (1..=50).contains(&n))
}
fn interval_ok(value: u32) -> bool {
    (300..=2_147_483_647).contains(&value)
}
fn cursor_ok(value: &Option<String>, check: fn(&str) -> bool) -> bool {
    value.as_deref().is_none_or(check)
}
impl Operation {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Hello => "hello",
            Self::SetupInspect => "setup.inspect",
            Self::SettingsInspect => "settings.inspect",
            Self::SetupConfigure { .. } => "setup.configure",
            Self::CredentialsReplace { .. } => "credentials.replace",
            Self::ServiceStart => "service.start",
            Self::ServiceStop => "service.stop",
            Self::ServiceRepair => "service.repair",
            Self::Overview => "overview",
            Self::WatchesList { .. } => "watches.list",
            Self::WatchesAdd { .. } => "watches.add",
            Self::WatchesUpdate { .. } => "watches.update",
            Self::WatchesPause { .. } => "watches.pause",
            Self::WatchesResume { .. } => "watches.resume",
            Self::WatchesRemove { .. } => "watches.remove",
            Self::SnapshotsTargets { .. } => "snapshots.targets",
            Self::SnapshotsList { .. } => "snapshots.list",
            Self::SnapshotsCompare { .. } => "snapshots.compare",
            Self::SnapshotsRead { .. } => "snapshots.read",
            Self::ChangesList { .. } => "changes.list",
            Self::ServiceInspect => "service.inspect",
            Self::ServiceMigrate => "service.migrate",
            Self::ServiceUninstall => "service.uninstall",
            Self::HomeInspect { .. } => "home.inspect",
            Self::HomeSelect { .. } => "home.select",
        }
    }
    pub fn budget(&self) -> Budget {
        match self {
            Self::Hello
            | Self::SetupInspect
            | Self::SettingsInspect
            | Self::Overview
            | Self::WatchesList { .. }
            | Self::SnapshotsTargets { .. }
            | Self::SnapshotsList { .. }
            | Self::SnapshotsCompare { .. }
            | Self::SnapshotsRead { .. }
            | Self::ChangesList { .. }
            | Self::ServiceInspect
            | Self::HomeInspect { .. } => Budget::Read,
            Self::WatchesAdd { .. }
            | Self::WatchesUpdate { .. }
            | Self::WatchesPause { .. }
            | Self::WatchesResume { .. }
            | Self::WatchesRemove { .. } => Budget::LocalMutation,
            Self::SetupConfigure { .. }
            | Self::CredentialsReplace { .. }
            | Self::ServiceStart
            | Self::ServiceStop
            | Self::ServiceRepair
            | Self::ServiceMigrate
            | Self::ServiceUninstall
            | Self::HomeSelect { .. } => Budget::ServiceMutation,
        }
    }
    pub fn is_mutation(&self) -> bool {
        self.budget() != Budget::Read
    }
    pub fn validate(&self) -> Result<(), HostError> {
        let ok = match self {
            Self::SetupConfigure { token } | Self::CredentialsReplace { token } => {
                return if (4..=4096).contains(&token.len())
                    && token.bytes().all(|b| (33..=126).contains(&b))
                {
                    Ok(())
                } else {
                    Err(HostError::InvalidToken)
                };
            }
            Self::Hello
            | Self::SetupInspect
            | Self::SettingsInspect
            | Self::ServiceStart
            | Self::ServiceStop
            | Self::ServiceRepair
            | Self::ServiceInspect
            | Self::ServiceMigrate
            | Self::ServiceUninstall
            | Self::Overview => true,
            Self::WatchesList { limit, cursor } => {
                limit_ok(*limit) && cursor_ok(cursor, watch_cursor)
            }
            Self::WatchesAdd {
                user,
                interval_seconds,
            } => canonical_user(user) && interval_seconds.is_none_or(interval_ok),
            Self::WatchesUpdate {
                user,
                revision,
                interval_seconds,
            } => canonical_user(user) && hex(revision, 64) && interval_ok(*interval_seconds),
            Self::WatchesPause { user, revision }
            | Self::WatchesResume { user, revision }
            | Self::WatchesRemove { user, revision } => canonical_user(user) && hex(revision, 64),
            Self::SnapshotsTargets {
                username,
                limit,
                cursor,
            } => canonical_user(username) && limit_ok(*limit) && cursor_ok(cursor, history_cursor),
            Self::SnapshotsList {
                target_pk: pk,
                limit,
                cursor,
            } => target_pk(pk) && limit_ok(*limit) && cursor_ok(cursor, history_cursor),
            Self::SnapshotsCompare {
                target_pk: pk,
                older_id,
                newer_id,
            } => {
                target_pk(pk)
                    && snapshot_id(older_id)
                    && snapshot_id(newer_id)
                    && older_id != newer_id
            }
            // One side of the compare pair: the same decimal rules and bounds,
            // so the two operations are validated identically.
            Self::SnapshotsRead {
                target_pk: pk,
                snapshot_id: id,
            } => target_pk(pk) && snapshot_id(id),
            Self::ChangesList {
                target_pk: pk,
                limit,
                cursor,
            } => {
                pk.as_deref().is_none_or(target_pk)
                    && limit_ok(*limit)
                    && cursor_ok(cursor, history_cursor)
            }
            Self::HomeInspect { path } => home_path_ok(path),
            Self::HomeSelect { path } => path.as_deref().is_none_or(home_path_ok),
        };
        if ok {
            Ok(())
        } else {
            Err(HostError::InvalidParams)
        }
    }
    pub fn request(&self, id: &str) -> Result<Vec<u8>, HostError> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(HostError::Protocol);
        }
        self.validate()?;
        let mut params = serde_json::Map::new();
        let text = |value: &str| Value::String(value.to_owned());
        match self {
            Self::SetupConfigure { token } | Self::CredentialsReplace { token } => {
                params.insert("token".into(), text(token));
            }
            Self::WatchesList { limit, cursor } => {
                if let Some(n) = limit {
                    params.insert("limit".into(), (*n).into());
                }
                if let Some(c) = cursor {
                    params.insert("cursor".into(), text(c));
                }
            }
            Self::WatchesAdd {
                user,
                interval_seconds,
            } => {
                params.insert("user".into(), text(user));
                if let Some(n) = interval_seconds {
                    params.insert("interval_seconds".into(), (*n).into());
                }
            }
            Self::WatchesUpdate {
                user,
                revision,
                interval_seconds,
            } => {
                params.insert("user".into(), text(user));
                params.insert("revision".into(), text(revision));
                params.insert("interval_seconds".into(), (*interval_seconds).into());
            }
            Self::WatchesPause { user, revision }
            | Self::WatchesResume { user, revision }
            | Self::WatchesRemove { user, revision } => {
                params.insert("user".into(), text(user));
                params.insert("revision".into(), text(revision));
            }
            Self::SnapshotsTargets {
                username,
                limit,
                cursor,
            } => {
                params.insert("username".into(), text(username));
                if let Some(n) = limit {
                    params.insert("limit".into(), (*n).into());
                }
                if let Some(c) = cursor {
                    params.insert("cursor".into(), text(c));
                }
            }
            Self::SnapshotsList {
                target_pk,
                limit,
                cursor,
            } => {
                params.insert("target_pk".into(), text(target_pk));
                if let Some(n) = limit {
                    params.insert("limit".into(), (*n).into());
                }
                if let Some(c) = cursor {
                    params.insert("cursor".into(), text(c));
                }
            }
            Self::SnapshotsCompare {
                target_pk,
                older_id,
                newer_id,
            } => {
                params.insert("target_pk".into(), text(target_pk));
                params.insert("older_id".into(), text(older_id));
                params.insert("newer_id".into(), text(newer_id));
            }
            Self::SnapshotsRead {
                target_pk,
                snapshot_id,
            } => {
                params.insert("target_pk".into(), text(target_pk));
                params.insert("snapshot_id".into(), text(snapshot_id));
            }
            Self::ChangesList {
                target_pk,
                limit,
                cursor,
            } => {
                if let Some(pk) = target_pk {
                    params.insert("target_pk".into(), text(pk));
                }
                if let Some(n) = limit {
                    params.insert("limit".into(), (*n).into());
                }
                if let Some(c) = cursor {
                    params.insert("cursor".into(), text(c));
                }
            }
            Self::HomeInspect { path } => {
                params.insert("path".into(), text(path));
            }
            Self::HomeSelect { path } => {
                // The core requires exactly `{"path": …}`; `null` is the own profile
                // and is only accepted for `home.select`.
                params.insert("path".into(), path.as_deref().map_or(Value::Null, text));
            }
            _ => {}
        }
        #[derive(Serialize)]
        struct Request<'a> {
            protocol_version: u8,
            request_id: &'a str,
            operation: &'a str,
            params: Value,
        }
        let mut bytes = serde_json::to_vec(&Request {
            protocol_version: 1,
            request_id: id,
            operation: self.name(),
            params: Value::Object(params),
        })
        .map_err(|_| HostError::Protocol)?;
        bytes.push(b'\n');
        if bytes.len() > MAX_REQUEST {
            return Err(HostError::Protocol);
        }
        Ok(bytes)
    }
}
// Deserialize recursively before DTO decoding: serde_json::Value alone silently
// overwrites duplicate keys, including duplicates in otherwise discarded fields.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Unique;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("strict JSON")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Unique, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| Unique(Value::Number(n)))
                    .ok_or_else(|| E::custom("number"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Unique, A::Error> {
                let mut values = Vec::new();
                while let Some(Unique(v)) = seq.next_element()? {
                    values.push(v);
                }
                Ok(Unique(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Unique, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((k, Unique(v))) = map.next_entry::<String, Unique>()? {
                    if values.insert(k, v).is_some() {
                        return Err(serde::de::Error::custom("duplicate"));
                    }
                }
                Ok(Unique(Value::Object(values)))
            }
        }
        d.deserialize_any(Visitor)
    }
}
pub(crate) fn strict_json(raw: &[u8]) -> Result<Value, HostError> {
    serde_json::from_slice::<Unique>(raw)
        .map(|Unique(value)| value)
        .map_err(|_| HostError::Protocol)
}
fn hello(result: &Value) -> Result<Hello, HostError> {
    let hello: Hello = serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    if hello.core_version != CORE_VERSION
        || hello.schema_version_supported != 2
        || hello.capabilities.len() != CAPABILITIES.len()
        || !CAPABILITIES.iter().all(|c| {
            hello
                .capabilities
                .iter()
                .filter(|s| s.as_str() == *c)
                .count()
                == 1
        })
    {
        return Err(HostError::Protocol);
    }
    Ok(hello)
}
fn profile(result: &Value) -> Result<Profile, HostError> {
    if result.as_object().map(|o| o.len()) != Some(7) {
        return Err(HostError::Protocol);
    }
    let profile: Profile =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    if profile.revision.as_deref().is_some_and(|r| !hex(r, 32)) {
        return Err(HostError::Protocol);
    }
    // `desired_service` and `revision` exist exactly when the profile is
    // configured. The two quota fields are written together (`profile.py:new_state`)
    // and an adopted home is configured with both still null until its next
    // credential check, so the rule for them is both-or-neither.
    let tied = [
        profile.desired_service.is_some(),
        profile.revision.is_some(),
    ];
    let quota = profile.quota_remaining.is_some() == profile.quota_checked_at.is_some()
        && (profile.configured || profile.quota_remaining.is_none());
    if !tied.iter().all(|present| *present == profile.configured) || !quota {
        return Err(HostError::Protocol);
    }
    let valid_status = match profile.status {
        Status::Unconfigured => !profile.configured && !profile.service_running,
        Status::RecoveryRequired => !profile.service_running,
        Status::QuotaExhausted => profile.configured && profile.quota_remaining == Some(0),
        Status::Running => {
            profile.configured && profile.service_running && profile.quota_remaining != Some(0)
        }
        Status::Stopped => {
            profile.configured && !profile.service_running && profile.quota_remaining != Some(0)
        }
        Status::ServiceError => profile.configured && !profile.service_running,
    };
    if !valid_status {
        return Err(HostError::Protocol);
    }
    Ok(profile)
}
fn exact_keys<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, HostError> {
    let obj = value.as_object().ok_or(HostError::Protocol)?;
    if obj.len() != keys.len() || !keys.iter().all(|key| obj.contains_key(*key)) {
        return Err(HostError::Protocol);
    }
    Ok(obj)
}
fn check_watch(watch: &Watch) -> Result<(), HostError> {
    let ok = canonical_user(&watch.user)
        && (300..=2_147_483_647).contains(&watch.interval_seconds)
        && watch.last_ok.is_none_or(|t| t <= MAX_TIME)
        && watch.waiting_first_check == watch.last_ok.is_none()
        && watch.consecutive_errors <= MAX_SAFE
        && hex(&watch.revision, 64);
    if ok {
        Ok(())
    } else {
        Err(HostError::Protocol)
    }
}
const WATCH_KEYS: [&str; 8] = [
    "user",
    "status",
    "interval_seconds",
    "last_ok",
    "waiting_first_check",
    "has_error",
    "consecutive_errors",
    "revision",
];
fn watch(value: &Value) -> Result<Watch, HostError> {
    exact_keys(value, &WATCH_KEYS)?;
    let watch: Watch = serde_json::from_value(value.clone()).map_err(|_| HostError::Protocol)?;
    check_watch(&watch)?;
    Ok(watch)
}
// Routes every nested watch of a derived page through `watch`, so each item
// keeps the exact key set instead of serde's missing-Option-as-null default.
fn watches<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<Watch>, D::Error> {
    Vec::<Value>::deserialize(d)?
        .iter()
        .map(|item| watch(item).map_err(serde::de::Error::custom))
        .collect()
}
/// Items are already validated by the `watches` adapter; this checks page shape only.
fn check_watch_list(items: &[Watch], cursor: Option<&str>) -> Result<(), HostError> {
    if items.len() > 50 || cursor.is_some_and(|c| !watch_cursor(c)) {
        return Err(HostError::Protocol);
    }
    if items.windows(2).any(|pair| pair[0].user >= pair[1].user) {
        return Err(HostError::Protocol);
    }
    Ok(())
}
fn watch_page(result: &Value) -> Result<WatchPage, HostError> {
    exact_keys(result, &["items", "next_cursor"])?;
    let page: WatchPage =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    check_watch_list(&page.items, page.next_cursor.as_deref())?;
    Ok(page)
}
fn overview(result: &Value) -> Result<Overview, HostError> {
    exact_keys(
        result,
        &[
            "configured",
            "desired_service",
            "service_state",
            "quota_remaining",
            "quota_checked_at",
            "watches",
            "next_cursor",
        ],
    )?;
    let overview: Overview =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    let configured = overview.configured;
    // The same quota rule as `profile`: `watches.py:overview` reads the two
    // fields out of the same saved state, so an adopted home reports both null
    // while configured. Relaxing this here is what keeps monitoring polling
    // after an adoption.
    let quota = overview.quota_remaining.is_some() == overview.quota_checked_at.is_some()
        && (configured || overview.quota_remaining.is_none());
    let ok = overview.desired_service.is_some() == configured
        && quota
        && overview.quota_checked_at.is_none_or(|t| t <= MAX_TIME)
        && (configured
            || (overview.watches.is_empty()
                && overview.next_cursor.is_none()
                && overview.service_state == ServiceState::Unknown));
    if !ok {
        return Err(HostError::Protocol);
    }
    check_watch_list(&overview.watches, overview.next_cursor.as_deref())?;
    Ok(overview)
}
const SERVICE_INSPECTION_KEYS: [&str; 5] = [
    "registration",
    "interpreter",
    "interpreter_exists",
    "loaded",
    "settings",
];
fn service_inspection(result: &Value) -> Result<ServiceInspection, HostError> {
    exact_keys(result, &SERVICE_INSPECTION_KEYS)?;
    let facts: ServiceInspection =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    // `service_facts.registration_facts`: only an owned registration names an
    // interpreter, and only an owned one is compared against the home's
    // configuration; a loaded job forces `unknown`, so `none` is never loaded.
    // `loaded` may be null for any registration (launchd unreachable).
    let owned = facts.registration == Registration::Owned;
    let ok = facts.interpreter.is_some() == owned
        && facts.interpreter_exists.is_some() == owned
        && (owned || facts.settings.is_none())
        && (facts.registration != Registration::None || facts.loaded != Some(true));
    if !ok {
        return Err(HostError::Protocol);
    }
    Ok(facts)
}
const HOME_INSPECTION_KEYS: [&str; 12] = [
    "path",
    "exists",
    "private",
    "config",
    "backend",
    "database",
    "registration",
    "interpreter",
    "loaded",
    "process",
    "adoptable",
    "reason",
];
// A private home is described from what the core actually read: registration
// facts from `registration_facts`, the verdict from `home.py:_reason`.
fn inspected(report: &HomeInspection) -> bool {
    let owned = report.registration == Registration::Owned;
    let facts = report.interpreter.is_some() == owned
        && (report.registration != Registration::None || report.loaded != Some(true))
        && match report.loaded {
            Some(false) => report.process == ProcessState::Stopped,
            None => report.process == ProcessState::Unknown,
            Some(true) => true,
        };
    let hikerapi = report.backend == Some(Backend::Hikerapi);
    let verdict = match report.reason {
        None => {
            report.config == ConfigState::Ok
                && hikerapi
                && matches!(report.database, DatabaseState::Ok | DatabaseState::Missing)
        }
        Some(Reason::HomeBackendUnsupported) => report.config == ConfigState::Ok && !hikerapi,
        Some(Reason::SchemaMismatch) => {
            report.config == ConfigState::Ok
                && hikerapi
                && report.database == DatabaseState::SchemaMismatch
        }
        Some(Reason::StorageError) => {
            report.config == ConfigState::Ok
                && hikerapi
                && report.database == DatabaseState::Unreadable
        }
        // `home_invalid` also covers a private home that is another desktop
        // root's own profile — a perfect shape the core still refuses — so this
        // reason implies nothing about the rest of the report.
        Some(Reason::HomeInvalid) => true,
    };
    // `config == "missing"` is the only config state that fixes the backend.
    let config = report.config != ConfigState::Missing || report.backend.is_none();
    facts && config && verdict && report.adoptable == report.reason.is_none()
}
fn home_inspection(result: &Value) -> Result<HomeInspection, HostError> {
    exact_keys(result, &HOME_INSPECTION_KEYS)?;
    let report: HomeInspection =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    // `home.py:_inspect` returns one of three shapes. A missing path and a
    // non-private path are fixed reports: nothing inside them is read, so every
    // field they carry is a constant.
    let unread = report.backend.is_none()
        && report.interpreter.is_none()
        && report.loaded.is_none()
        && report.process == ProcessState::Unknown
        && !report.adoptable
        && report.reason == Some(Reason::HomeInvalid);
    let shape = if !report.exists {
        !report.private
            && report.config == ConfigState::Missing
            && report.database == DatabaseState::Missing
            && report.registration == Registration::None
            && unread
    } else if !report.private {
        report.config == ConfigState::Invalid
            && report.database == DatabaseState::Unreadable
            && report.registration == Registration::Unknown
            && unread
    } else {
        inspected(&report)
    };
    if !response_path_ok(&report.path) || !shape {
        return Err(HostError::Protocol);
    }
    Ok(report)
}
fn single_watch(result: &Value, user: &str) -> Result<Watch, HostError> {
    let item = watch(&exact_keys(result, &["watch"])?["watch"])?;
    if item.user != user {
        return Err(HostError::Protocol);
    }
    Ok(item)
}
fn removed(result: &Value, user: &str) -> Result<Removed, HostError> {
    exact_keys(result, &["removed_user"])?;
    let removed: Removed =
        serde_json::from_value(result.clone()).map_err(|_| HostError::Protocol)?;
    if removed.removed_user != user {
        return Err(HostError::Protocol);
    }
    Ok(removed)
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum PageKind {
    Targets,
    List,
    Changes,
}
fn snapshot(value: &Value) -> Result<Snapshot, HostError> {
    exact_keys(value, &["id", "target_pk", "captured_at"])?;
    let snapshot: Snapshot =
        serde_json::from_value(value.clone()).map_err(|_| HostError::Protocol)?;
    if !snapshot_id(&snapshot.id)
        || !target_pk(&snapshot.target_pk)
        || snapshot.captured_at > MAX_TIME
    {
        return Err(HostError::Protocol);
    }
    Ok(snapshot)
}
fn key(snapshot: &Snapshot) -> (u64, i64) {
    (
        snapshot.captured_at,
        snapshot.id.parse().unwrap_or_default(),
    )
}
fn field_name(name: &str) -> bool {
    (1..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
}
fn change_value(value: &Value) -> Result<ChangeValue, HostError> {
    match value {
        Value::Null => Ok(ChangeValue::Null),
        Value::Bool(b) => Ok(ChangeValue::Bool(*b)),
        Value::Number(n) => n
            .as_u64()
            .filter(|n| *n <= MAX_SAFE)
            .map(ChangeValue::Integer)
            .ok_or(HostError::Protocol),
        Value::String(s) => Ok(ChangeValue::Text(s.clone())),
        _ => Err(HostError::Protocol),
    }
}
fn comparison(value: &Value, expected_kind: &str) -> Result<Comparison, HostError> {
    let obj = exact_keys(
        value,
        &["kind", "older", "newer", "changes", "unknown_fields"],
    )?;
    if obj["kind"].as_str() != Some(expected_kind) {
        return Err(HostError::Protocol);
    }
    let older = snapshot(&obj["older"])?;
    let newer = snapshot(&obj["newer"])?;
    if older.target_pk != newer.target_pk || key(&older) >= key(&newer) {
        return Err(HostError::Protocol);
    }
    let mut changes = Vec::new();
    for change in obj["changes"].as_array().ok_or(HostError::Protocol)? {
        let item = exact_keys(change, &["field", "old", "new"])?;
        let field = item["field"]
            .as_str()
            .filter(|f| field_name(f))
            .ok_or(HostError::Protocol)?;
        changes.push(Change {
            field: field.to_owned(),
            old: change_value(&item["old"])?,
            new: change_value(&item["new"])?,
        });
    }
    let mut unknown_fields = Vec::new();
    for name in obj["unknown_fields"]
        .as_array()
        .ok_or(HostError::Protocol)?
    {
        unknown_fields.push(
            name.as_str()
                .filter(|f| field_name(f))
                .ok_or(HostError::Protocol)?
                .to_owned(),
        );
    }
    if changes.len() > 64 || unknown_fields.len() > 64 {
        return Err(HostError::Protocol);
    }
    Ok(Comparison {
        older,
        newer,
        changes,
        unknown_fields,
    })
}
fn history_item(value: &Value, kind: PageKind) -> Result<HistoryItem, HostError> {
    let obj = value.as_object().ok_or(HostError::Protocol)?;
    let tag = obj
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(HostError::Protocol)?;
    Ok(match (kind, tag) {
        (PageKind::Targets, "target") => {
            exact_keys(value, &["kind", "target_pk", "snapshot"])?;
            let snapshot = snapshot(&obj["snapshot"])?;
            let pk = obj["target_pk"].as_str().ok_or(HostError::Protocol)?;
            if pk != snapshot.target_pk {
                return Err(HostError::Protocol);
            }
            HistoryItem::Target {
                target_pk: pk.to_owned(),
                snapshot,
            }
        }
        (PageKind::List, "snapshot") => {
            exact_keys(value, &["kind", "snapshot"])?;
            HistoryItem::Snapshot {
                snapshot: snapshot(&obj["snapshot"])?,
            }
        }
        (PageKind::Changes, "baseline") => {
            exact_keys(value, &["kind", "snapshot"])?;
            HistoryItem::Baseline {
                snapshot: snapshot(&obj["snapshot"])?,
            }
        }
        (PageKind::Changes, "comparison") => {
            let c = comparison(value, "comparison")?;
            if c.changes.is_empty() || !c.unknown_fields.is_empty() {
                return Err(HostError::Protocol);
            }
            HistoryItem::Comparison {
                older: c.older,
                newer: c.newer,
                changes: c.changes,
                unknown_fields: c.unknown_fields,
            }
        }
        (PageKind::Changes, "incomplete") => {
            let c = comparison(value, "incomplete")?;
            if c.unknown_fields.is_empty() {
                return Err(HostError::Protocol);
            }
            HistoryItem::Incomplete {
                older: c.older,
                newer: c.newer,
                changes: c.changes,
                unknown_fields: c.unknown_fields,
            }
        }
        (_, "diagnostic") => {
            exact_keys(value, &["kind", "snapshot", "code"])?;
            let code: DiagnosticCode =
                serde_json::from_value(obj["code"].clone()).map_err(|_| HostError::Protocol)?;
            if code == DiagnosticCode::HistoryIdentityUnknown && kind != PageKind::Targets {
                return Err(HostError::Protocol);
            }
            HistoryItem::Diagnostic {
                snapshot: snapshot(&obj["snapshot"])?,
                code,
            }
        }
        _ => return Err(HostError::Protocol),
    })
}
fn history_page(
    result: &Value,
    kind: PageKind,
    filter: Option<&str>,
    limit: u8,
) -> Result<HistoryPage, HostError> {
    let obj = exact_keys(
        result,
        &["items", "next_cursor", "scan_complete", "scanned"],
    )?;
    let next_cursor = match &obj["next_cursor"] {
        Value::Null => None,
        Value::String(cursor) if history_cursor(cursor) => Some(cursor.clone()),
        _ => return Err(HostError::Protocol),
    };
    let scan_complete = obj["scan_complete"].as_bool().ok_or(HostError::Protocol)?;
    let scanned = obj["scanned"].as_u64().ok_or(HostError::Protocol)?;
    let raw = obj["items"].as_array().ok_or(HostError::Protocol)?;
    if scan_complete != next_cursor.is_none() || scanned > 2000 || raw.len() > usize::from(limit) {
        return Err(HostError::Protocol);
    }
    let mut items = Vec::with_capacity(raw.len());
    let mut previous: Option<(u64, i64)> = None;
    let mut seen_targets: Vec<String> = Vec::new();
    for value in raw {
        let item = history_item(value, kind)?;
        let current = match &item {
            HistoryItem::Comparison { newer, .. } | HistoryItem::Incomplete { newer, .. } => newer,
            HistoryItem::Target { snapshot, .. }
            | HistoryItem::Snapshot { snapshot }
            | HistoryItem::Baseline { snapshot }
            | HistoryItem::Diagnostic { snapshot, .. } => snapshot,
        };
        if filter.is_some_and(|pk| pk != current.target_pk) {
            return Err(HostError::Protocol);
        }
        if let HistoryItem::Target { target_pk, .. } = &item {
            if seen_targets.contains(target_pk) {
                return Err(HostError::Protocol);
            }
            seen_targets.push(target_pk.clone());
        }
        let current_key = key(current);
        if previous.is_some_and(|p| p <= current_key) {
            return Err(HostError::Protocol);
        }
        previous = Some(current_key);
        items.push(item);
    }
    Ok(HistoryPage {
        items,
        next_cursor,
        scan_complete,
        scanned,
    })
}
// `snapshots.read`: the same bounds the comparison applies to its change values —
// field names, value typing and a 64-entry ceiling on each of the two collections.
fn snapshot_fields(value: &Value, pk: &str, id: &str) -> Result<SnapshotFields, HostError> {
    let obj = exact_keys(value, &["kind", "snapshot", "fields", "unknown_fields"])?;
    if obj["kind"].as_str() != Some("snapshot_fields") {
        return Err(HostError::Protocol);
    }
    let snapshot = snapshot(&obj["snapshot"])?;
    if snapshot.target_pk != pk || snapshot.id != id {
        return Err(HostError::Protocol);
    }
    let raw = obj["fields"].as_object().ok_or(HostError::Protocol)?;
    let mut fields = std::collections::BTreeMap::new();
    for (name, value) in raw {
        if !field_name(name) {
            return Err(HostError::Protocol);
        }
        fields.insert(name.clone(), change_value(value)?);
    }
    let mut unknown_fields = Vec::new();
    for name in obj["unknown_fields"]
        .as_array()
        .ok_or(HostError::Protocol)?
    {
        let name = name
            .as_str()
            .filter(|f| field_name(f))
            .ok_or(HostError::Protocol)?;
        // A field is either known with a value or listed as unknown, never both.
        if fields.contains_key(name) {
            return Err(HostError::Protocol);
        }
        unknown_fields.push(name.to_owned());
    }
    if fields.len() > 64 || unknown_fields.len() > 64 {
        return Err(HostError::Protocol);
    }
    Ok(SnapshotFields {
        snapshot,
        fields,
        unknown_fields,
    })
}
fn compare_result(
    result: &Value,
    pk: &str,
    older_id: &str,
    newer_id: &str,
) -> Result<Comparison, HostError> {
    let c = comparison(result, "comparison")?;
    if c.older.target_pk != pk
        || c.newer.target_pk != pk
        || c.older.id != older_id
        || c.newer.id != newer_id
    {
        return Err(HostError::Protocol);
    }
    Ok(c)
}
pub fn decode(raw: &[u8], id: &str, operation: &Operation) -> Result<Response, HostError> {
    let bad = || HostError::Protocol;
    if raw.len() > MAX_RESPONSE
        || raw.last() != Some(&b'\n')
        || raw[..raw.len().saturating_sub(1)]
            .iter()
            .any(|b| matches!(b, b'\n' | b'\r'))
    {
        return Err(bad());
    }
    let value = strict_json(raw)?;
    let obj = value.as_object().ok_or_else(bad)?;
    if obj.len() != 3
        || obj.get("protocol_version").and_then(Value::as_u64) != Some(1)
        || obj.get("request_id").and_then(Value::as_str) != Some(id)
    {
        return Err(bad());
    }
    if let Some(result) = obj.get("result") {
        return Ok(match operation {
            Operation::Hello => Response::Hello(hello(result)?),
            Operation::SetupInspect
            | Operation::SettingsInspect
            | Operation::SetupConfigure { .. }
            | Operation::CredentialsReplace { .. }
            | Operation::ServiceStart
            | Operation::ServiceStop
            | Operation::ServiceRepair
            | Operation::ServiceMigrate
            | Operation::ServiceUninstall
            | Operation::HomeSelect { .. } => Response::Profile(profile(result)?),
            Operation::Overview => Response::Overview(overview(result)?),
            Operation::WatchesList { .. } => Response::WatchPage(watch_page(result)?),
            Operation::WatchesAdd { user, .. }
            | Operation::WatchesUpdate { user, .. }
            | Operation::WatchesPause { user, .. }
            | Operation::WatchesResume { user, .. } => Response::Watch(single_watch(result, user)?),
            Operation::WatchesRemove { user, .. } => Response::Removed(removed(result, user)?),
            Operation::SnapshotsTargets { limit, .. } => Response::HistoryPage(history_page(
                result,
                PageKind::Targets,
                None,
                limit.unwrap_or(50),
            )?),
            Operation::SnapshotsList {
                target_pk, limit, ..
            } => Response::HistoryPage(history_page(
                result,
                PageKind::List,
                Some(target_pk),
                limit.unwrap_or(50),
            )?),
            Operation::SnapshotsCompare {
                target_pk,
                older_id,
                newer_id,
            } => Response::Comparison(compare_result(result, target_pk, older_id, newer_id)?),
            Operation::SnapshotsRead {
                target_pk,
                snapshot_id,
            } => Response::SnapshotFields(snapshot_fields(result, target_pk, snapshot_id)?),
            Operation::ChangesList {
                target_pk, limit, ..
            } => Response::HistoryPage(history_page(
                result,
                PageKind::Changes,
                target_pk.as_deref(),
                limit.unwrap_or(50),
            )?),
            Operation::ServiceInspect => Response::ServiceInspection(service_inspection(result)?),
            Operation::HomeInspect { .. } => Response::HomeInspection(home_inspection(result)?),
        });
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WireError {
        code: String,
        message: String,
        retryable: bool,
    }
    let error: WireError =
        serde_json::from_value(obj.get("error").ok_or_else(bad)?.clone()).map_err(|_| bad())?;
    let _ = (error.message, error.retryable);
    let (code, message, retryable) = match error.code.as_str() {
        "invalid_request" => ("invalid_request", "Invalid desktop request.", false),
        "unsupported_protocol" => (
            "unsupported_protocol",
            "Unsupported desktop protocol.",
            false,
        ),
        "unsupported_operation" => (
            "unsupported_operation",
            "Unsupported desktop operation.",
            false,
        ),
        "invalid_params" => ("invalid_params", "Invalid operation parameters.", false),
        "internal_error" => ("internal_error", "Desktop operation failed.", false),
        "invalid_token" => ("invalid_token", "The token was rejected.", false),
        "quota_exhausted" => ("quota_exhausted", "Provider quota is exhausted.", false),
        "rate_limited" => (
            "rate_limited",
            "Provider access is temporarily rate limited.",
            true,
        ),
        "network_error" => (
            "network_error",
            "Provider access is temporarily unavailable.",
            true,
        ),
        "access_unconfirmed" => (
            "access_unconfirmed",
            "Provider access could not be confirmed.",
            true,
        ),
        "operation_timeout" => (
            "operation_timeout",
            "The operation timed out; inspect its state before retrying.",
            false,
        ),
        "profile_busy" => (
            "profile_busy",
            "Another profile operation is in progress.",
            true,
        ),
        "profile_ownership" => (
            "profile_ownership",
            "The profile cannot be managed safely.",
            false,
        ),
        "not_configured" => ("not_configured", "The profile is not configured.", false),
        "already_configured" => (
            "already_configured",
            "Use credential replacement for a configured profile.",
            false,
        ),
        "recovery_required" => (
            "recovery_required",
            "The profile requires recovery before another change.",
            false,
        ),
        "service_error" => (
            "service_error",
            "The background service could not reach the requested state.",
            false,
        ),
        "storage_error" => (
            "storage_error",
            "Private profile storage is unavailable.",
            false,
        ),
        "schema_mismatch" => (
            "schema_mismatch",
            "The profile database schema is incompatible.",
            false,
        ),
        "home_invalid" => (
            "home_invalid",
            "The selected home cannot be used safely.",
            false,
        ),
        "home_backend_unsupported" => (
            "home_backend_unsupported",
            "The selected home uses an unsupported backend.",
            false,
        ),
        "service_ownership_unknown" => (
            "service_ownership_unknown",
            "The service registration has unknown ownership; only reading is allowed.",
            false,
        ),
        "service_config_mismatch" => (
            "service_config_mismatch",
            "The registered service uses settings that differ from the home's configuration.",
            false,
        ),
        "unsupported_platform" => (
            "unsupported_platform",
            "Desktop service management requires macOS.",
            false,
        ),
        "watch_conflict" => (
            "watch_conflict",
            "The watch changed; refresh it before retrying.",
            false,
        ),
        "watch_not_found" => (
            "watch_not_found",
            "The watch no longer exists; refresh the list.",
            false,
        ),
        "watch_exists" => (
            "watch_exists",
            "The watch already exists; refresh the list.",
            false,
        ),
        "watch_limit" => ("watch_limit", "At most three watches can be active.", false),
        "history_corrupt" => (
            "history_corrupt",
            "A saved snapshot cannot be read safely.",
            false,
        ),
        "history_oversized" => (
            "history_oversized",
            "A saved snapshot exceeds the supported size.",
            false,
        ),
        "snapshot_unavailable" => (
            "snapshot_unavailable",
            "A selected snapshot is no longer available; refresh the list.",
            false,
        ),
        "snapshot_identity_mismatch" => (
            "snapshot_identity_mismatch",
            "Select snapshots from the same saved account history.",
            false,
        ),
        _ => return Err(bad()),
    };
    Ok(Response::Error(SafeError {
        code,
        message,
        retryable,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    const HELLO: &str = r#"{"core_version":"0.7.22","schema_version_supported":2,"capabilities":["hello","setup.inspect","setup.configure","settings.inspect","credentials.replace","service.start","service.stop","service.repair","overview","watches.list","watches.add","watches.update","watches.pause","watches.resume","watches.remove","snapshots.targets","snapshots.list","snapshots.compare","snapshots.read","changes.list","service.inspect","service.migrate","service.uninstall","home.inspect","home.select"]}"#;
    fn envelope(result: &str) -> Vec<u8> {
        format!("{{\"protocol_version\":1,\"request_id\":\"test\",\"result\":{result}}}\n")
            .into_bytes()
    }
    #[test]
    fn request_bytes_and_tokens() {
        assert_eq!(Operation::Hello.request("test").unwrap(), b"{\"protocol_version\":1,\"request_id\":\"test\",\"operation\":\"hello\",\"params\":{}}\n");
        for token in [
            "abc".into(),
            "a bcd".into(),
            "éabc".into(),
            "a".repeat(4097),
        ] {
            assert_eq!(
                Operation::SetupConfigure { token }.request("test"),
                Err(HostError::InvalidToken)
            );
        }
        for token in ["abcd".into(), "a".repeat(4096), "a\\\"b".into()] {
            assert!(Operation::CredentialsReplace { token }
                .request("test")
                .is_ok());
        }
        assert!(Operation::Hello.request("bad id").is_err());
    }
    #[test]
    fn hello_strict_envelope() {
        let valid = envelope(HELLO);
        assert!(decode(&valid, "test", &Operation::Hello).is_ok());
        for invalid in [
            String::from_utf8(valid.clone())
                .unwrap()
                .replace(":1,", ":true,"),
            String::from_utf8(valid.clone())
                .unwrap()
                .replace("\"test\"", "\"wrong\""),
            String::from_utf8(valid.clone())
                .unwrap()
                .replace("\"result\":", "\"extra\":0,\"result\":"),
            String::from_utf8(valid.clone())
                .unwrap()
                .replace("\"result\":", "\"request_id\":\"test\",\"result\":"),
            String::from_utf8(valid.clone())
                .unwrap()
                .replace(CORE_VERSION, "0.7.19"),
            String::from_utf8(valid.clone()).unwrap().replace(
                "\"schema_version_supported\":2",
                "\"schema_version_supported\":2,\"schema_version_supported\":2",
            ),
        ] {
            assert!(decode(invalid.as_bytes(), "test", &Operation::Hello).is_err());
        }
        assert!(decode(&[255, b'\n'], "test", &Operation::Hello).is_err());
        assert!(decode(&[valid.clone(), valid].concat(), "test", &Operation::Hello).is_err());
    }
    #[test]
    fn profile_recovery_and_schema() {
        let profile = r#"{"configured":false,"status":"recovery_required","desired_service":null,"service_running":false,"quota_remaining":null,"quota_checked_at":null,"revision":null}"#;
        assert!(decode(&envelope(profile), "test", &Operation::SetupInspect).is_ok());
        for invalid in [
            profile.replace("recovery_required", "unexpected"),
            profile.replace("null", "NaN"),
            profile.replace(
                "\"configured\":false",
                "\"configured\":false,\"secret\":\"TOKEN_SENTINEL\"",
            ),
        ] {
            assert!(decode(&envelope(&invalid), "test", &Operation::SetupInspect).is_err());
        }
    }
    #[test]
    fn errors_never_reflect_message() {
        let raw = b"{\"protocol_version\":1,\"request_id\":\"test\",\"error\":{\"code\":\"invalid_token\",\"message\":\"TOKEN_SENTINEL /secret/path\",\"retryable\":false}}\n";
        let result = decode(raw, "test", &Operation::Hello).unwrap();
        assert!(!format!("{result:?}").contains("TOKEN_SENTINEL"));
        assert!(decode(
            &String::from_utf8_lossy(raw)
                .replace("invalid_token", "unknown")
                .into_bytes(),
            "test",
            &Operation::Hello
        )
        .is_err());
    }
    #[test]
    fn profile_semantics_and_required_nullable_fields() {
        let profile = r#"{"configured":true,"status":"running","desired_service":"stopped","service_running":true,"quota_remaining":1,"quota_checked_at":0,"revision":"0123456789abcdef0123456789abcdef"}"#;
        assert!(decode(&envelope(profile), "test", &Operation::SettingsInspect).is_ok());
        for bad in [
            profile.replace("\"service_running\":true", "\"service_running\":false"),
            profile.replace("\"quota_remaining\":1", "\"quota_remaining\":0"),
            profile.replace("\"configured\":true", "\"configured\":false"),
            profile.replace("\"quota_checked_at\":0,", ""),
            profile.replace("\"quota_checked_at\":0", "\"quota_checked_at\":null"),
        ] {
            assert!(
                decode(&envelope(&bad), "test", &Operation::SettingsInspect).is_err(),
                "accepted inconsistent profile"
            );
        }
        let zero = profile
            .replace("\"quota_remaining\":1", "\"quota_remaining\":0")
            .replace("\"status\":\"running\"", "\"status\":\"quota_exhausted\"");
        assert!(decode(&envelope(&zero), "test", &Operation::SettingsInspect).is_ok());
    }
    #[test]
    fn full_wire_and_request_boundaries() {
        for operation in [
            Operation::Hello,
            Operation::SetupInspect,
            Operation::SettingsInspect,
            Operation::ServiceStart,
            Operation::ServiceStop,
            Operation::ServiceRepair,
        ] {
            let request = operation.request(&"x".repeat(64)).unwrap();
            let value: Value = serde_json::from_slice(&request).unwrap();
            assert_eq!(value["operation"], operation.name());
            assert_eq!(value["params"], serde_json::json!({}));
        }
        for id in [
            "".into(),
            "x".repeat(65),
            "é".into(),
            "a.b".into(),
            "a\n".into(),
        ] {
            assert!(Operation::Hello.request(&id).is_err());
        }
        for token in ["abc\n", "abc\r", "abc\t", "abc\0", "abc\x7f"] {
            assert!(Operation::SetupConfigure {
                token: token.into()
            }
            .request("id")
            .is_err());
        }
        assert!(!format!(
            "{:?}",
            Operation::SetupConfigure {
                token: "SECRET_SENTINEL".into()
            }
        )
        .contains("SECRET_SENTINEL"));
        let valid = envelope(HELLO);
        let text = String::from_utf8(valid.clone()).unwrap();
        for raw in [
            text.trim_end().into(),
            text.replace(":1,", ":1.0,"),
            text.replace("\"result\":", "\"error\":null,\"result\":"),
            text.replace("\"capabilities\":", "\"unknown\":0,\"capabilities\":"),
            text.replace("\"service.stop\",", ""),
            text.replace("\"service.stop\"", "\"service.start\""),
            text.replace(
                "\"schema_version_supported\":2",
                "\"schema_version_supported\":2.0",
            ),
            text.replace(
                "\"schema_version_supported\":2",
                "\"schema_version_supported\":1e999",
            ),
        ] {
            assert!(decode(raw.as_bytes(), "test", &Operation::Hello).is_err());
        }
        let mut exact = vec![b' '; MAX_RESPONSE - valid.len()];
        exact.extend_from_slice(&valid);
        assert!(decode(&exact, "test", &Operation::Hello).is_ok());
        exact.insert(0, b' ');
        assert!(decode(&exact, "test", &Operation::Hello).is_err());
    }
    #[test]
    fn every_domain_error_is_static_and_every_status_matches_c1() {
        for code in [
            "invalid_request",
            "unsupported_protocol",
            "unsupported_operation",
            "invalid_params",
            "internal_error",
            "invalid_token",
            "quota_exhausted",
            "rate_limited",
            "network_error",
            "access_unconfirmed",
            "operation_timeout",
            "profile_busy",
            "profile_ownership",
            "not_configured",
            "already_configured",
            "recovery_required",
            "service_error",
            "storage_error",
            "schema_mismatch",
            "unsupported_platform",
            "watch_conflict",
            "watch_not_found",
            "watch_exists",
            "watch_limit",
            "history_corrupt",
            "history_oversized",
            "snapshot_unavailable",
            "snapshot_identity_mismatch",
        ] {
            let raw=format!("{{\"protocol_version\":1,\"request_id\":\"test\",\"error\":{{\"code\":\"{code}\",\"message\":\"STDOUT_SECRET /private/path\",\"retryable\":false}}}}\n");
            let response = decode(raw.as_bytes(), "test", &Operation::SetupInspect).unwrap();
            let safe = serde_json::to_string(&response).unwrap();
            assert!(safe.contains(code));
            assert!(!safe.contains("STDOUT_SECRET"));
            assert!(!safe.contains("/private/path"));
            for invalid in [
                raw.replace("\"retryable\":false", "\"retryable\":0"),
                raw.replace("\"retryable\":false", "\"retryable\":false,\"extra\":0"),
                raw.replace("\"message\":", "\"code\":\"invalid_token\",\"message\":"),
            ] {
                assert!(decode(invalid.as_bytes(), "test", &Operation::SetupInspect).is_err());
            }
        }
        for status in ["stopped", "recovery_required", "service_error"] {
            let profile=format!("{{\"configured\":true,\"status\":\"{status}\",\"desired_service\":\"running\",\"service_running\":false,\"quota_remaining\":1,\"quota_checked_at\":0,\"revision\":\"0123456789abcdef0123456789abcdef\"}}");
            assert!(decode(&envelope(&profile), "test", &Operation::SettingsInspect).is_ok());
        }
    }
    #[test]
    fn c2_requests_carry_only_present_params() {
        let cases: Vec<(Operation, &str)> = vec![
            (Operation::Overview, r#""operation":"overview","params":{}"#),
            (
                Operation::WatchesList {
                    limit: None,
                    cursor: None,
                },
                r#""operation":"watches.list","params":{}"#,
            ),
            (
                Operation::WatchesList {
                    limit: Some(10),
                    cursor: Some("w1.YWxpY2U".into()),
                },
                r#""operation":"watches.list","params":{"cursor":"w1.YWxpY2U","limit":10}"#,
            ),
            (
                Operation::WatchesAdd {
                    user: "alice".into(),
                    interval_seconds: None,
                },
                r#""operation":"watches.add","params":{"user":"alice"}"#,
            ),
            (
                Operation::WatchesAdd {
                    user: "alice".into(),
                    interval_seconds: Some(600),
                },
                r#""operation":"watches.add","params":{"interval_seconds":600,"user":"alice"}"#,
            ),
            (
                Operation::WatchesUpdate {
                    user: "alice".into(),
                    revision: "a".repeat(64),
                    interval_seconds: 900,
                },
                r#""operation":"watches.update","params":{"interval_seconds":900,"revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"alice"}"#,
            ),
            (
                Operation::WatchesRemove {
                    user: "alice".into(),
                    revision: "b".repeat(64),
                },
                r#""operation":"watches.remove","params":{"revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","user":"alice"}"#,
            ),
            (
                Operation::SnapshotsTargets {
                    username: "alice".into(),
                    limit: None,
                    cursor: None,
                },
                r#""operation":"snapshots.targets","params":{"username":"alice"}"#,
            ),
            (
                Operation::SnapshotsList {
                    target_pk: "7".into(),
                    limit: Some(1),
                    cursor: Some("eyJ2IjoxfQ".into()),
                },
                r#""operation":"snapshots.list","params":{"cursor":"eyJ2IjoxfQ","limit":1,"target_pk":"7"}"#,
            ),
            (
                Operation::SnapshotsCompare {
                    target_pk: "7".into(),
                    older_id: "1".into(),
                    newer_id: "2".into(),
                },
                r#""operation":"snapshots.compare","params":{"newer_id":"2","older_id":"1","target_pk":"7"}"#,
            ),
            (
                Operation::SnapshotsRead {
                    target_pk: "7".into(),
                    snapshot_id: "2".into(),
                },
                r#""operation":"snapshots.read","params":{"snapshot_id":"2","target_pk":"7"}"#,
            ),
            (
                Operation::ChangesList {
                    target_pk: None,
                    limit: None,
                    cursor: None,
                },
                r#""operation":"changes.list","params":{}"#,
            ),
            (
                Operation::ChangesList {
                    target_pk: Some("8".into()),
                    limit: Some(50),
                    cursor: None,
                },
                r#""operation":"changes.list","params":{"limit":50,"target_pk":"8"}"#,
            ),
        ];
        for (operation, expected) in cases {
            let bytes = operation.request("test").unwrap();
            let text = String::from_utf8(bytes).unwrap();
            assert!(text.contains(expected), "{text}");
            assert!(text.ends_with("}\n"));
        }
    }
    #[test]
    fn c2_parameter_bounds_match_the_core() {
        let rev = "a".repeat(64);
        let invalid = vec![
            Operation::WatchesAdd {
                user: "Alice".into(),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: "@alice".into(),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: " alice".into(),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: ".".into(),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: "..".into(),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: "a".repeat(256),
                interval_seconds: None,
            },
            Operation::WatchesAdd {
                user: "alice".into(),
                interval_seconds: Some(299),
            },
            Operation::WatchesAdd {
                user: "alice".into(),
                interval_seconds: Some(2_147_483_648),
            },
            Operation::WatchesUpdate {
                user: "alice".into(),
                revision: "a".repeat(63),
                interval_seconds: 300,
            },
            Operation::WatchesPause {
                user: "alice".into(),
                revision: "A".repeat(64),
            },
            Operation::WatchesList {
                limit: Some(0),
                cursor: None,
            },
            Operation::WatchesList {
                limit: Some(51),
                cursor: None,
            },
            Operation::WatchesList {
                limit: None,
                cursor: Some("w1.".into()),
            },
            Operation::WatchesList {
                limit: None,
                cursor: Some("x1.abc".into()),
            },
            Operation::WatchesList {
                limit: None,
                cursor: Some("w1.a b".into()),
            },
            Operation::WatchesList {
                limit: None,
                cursor: Some(format!("w1.{}", "a".repeat(510))),
            },
            Operation::SnapshotsList {
                target_pk: "0".into(),
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsList {
                target_pk: "07".into(),
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsList {
                target_pk: "1".repeat(65),
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsList {
                target_pk: "7".into(),
                limit: None,
                cursor: Some(String::new()),
            },
            Operation::SnapshotsList {
                target_pk: "7".into(),
                limit: None,
                cursor: Some("a+b".into()),
            },
            Operation::SnapshotsList {
                target_pk: "7".into(),
                limit: None,
                cursor: Some("a".repeat(1025)),
            },
            Operation::SnapshotsCompare {
                target_pk: "7".into(),
                older_id: "1".into(),
                newer_id: "1".into(),
            },
            Operation::SnapshotsCompare {
                target_pk: "7".into(),
                older_id: "0".into(),
                newer_id: "1".into(),
            },
            Operation::SnapshotsCompare {
                target_pk: "7".into(),
                older_id: "1".into(),
                newer_id: "9223372036854775808".into(),
            },
            Operation::SnapshotsRead {
                target_pk: "7".into(),
                snapshot_id: "0".into(),
            },
            Operation::SnapshotsRead {
                target_pk: "7".into(),
                snapshot_id: "9223372036854775808".into(),
            },
            Operation::SnapshotsRead {
                target_pk: "07".into(),
                snapshot_id: "1".into(),
            },
            Operation::SnapshotsTargets {
                username: "alice ".into(),
                limit: None,
                cursor: None,
            },
            Operation::ChangesList {
                target_pk: Some("x".into()),
                limit: None,
                cursor: None,
            },
        ];
        for operation in invalid {
            assert_eq!(
                operation.validate(),
                Err(HostError::InvalidParams),
                "{operation:?}"
            );
            assert_eq!(operation.request("id"), Err(HostError::InvalidParams));
        }
        for operation in [
            Operation::WatchesAdd {
                user: "a".repeat(255),
                interval_seconds: Some(2_147_483_647),
            },
            Operation::WatchesPause {
                user: "a.b_c9".into(),
                revision: rev.clone(),
            },
            Operation::SnapshotsCompare {
                target_pk: "1".repeat(64),
                older_id: "1".into(),
                newer_id: "9223372036854775807".into(),
            },
            Operation::SnapshotsRead {
                target_pk: "1".repeat(64),
                snapshot_id: "9223372036854775807".into(),
            },
            Operation::SnapshotsTargets {
                username: "alice".into(),
                limit: Some(50),
                cursor: Some("a".repeat(1024)),
            },
            Operation::WatchesList {
                limit: None,
                cursor: Some("w1.a".into()),
            },
        ] {
            assert_eq!(operation.validate(), Ok(()), "{operation:?}");
        }
        assert!(!format!(
            "{:?}",
            Operation::WatchesAdd {
                user: "secret_sentinel".into(),
                interval_seconds: None
            }
        )
        .contains("secret_sentinel"));
    }
    #[test]
    fn budget_classes_and_mutation_flags() {
        use crate::protocol::Budget;
        let rev = "a".repeat(64);
        for op in [
            Operation::Hello,
            Operation::SetupInspect,
            Operation::Overview,
            Operation::WatchesList {
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsTargets {
                username: "a".into(),
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsList {
                target_pk: "1".into(),
                limit: None,
                cursor: None,
            },
            Operation::SnapshotsCompare {
                target_pk: "1".into(),
                older_id: "1".into(),
                newer_id: "2".into(),
            },
            Operation::SnapshotsRead {
                target_pk: "1".into(),
                snapshot_id: "2".into(),
            },
            Operation::ChangesList {
                target_pk: None,
                limit: None,
                cursor: None,
            },
        ] {
            assert_eq!(op.budget(), Budget::Read);
            assert!(!op.is_mutation());
        }
        for op in [
            Operation::WatchesAdd {
                user: "a".into(),
                interval_seconds: None,
            },
            Operation::WatchesUpdate {
                user: "a".into(),
                revision: rev.clone(),
                interval_seconds: 300,
            },
            Operation::WatchesPause {
                user: "a".into(),
                revision: rev.clone(),
            },
            Operation::WatchesResume {
                user: "a".into(),
                revision: rev.clone(),
            },
            Operation::WatchesRemove {
                user: "a".into(),
                revision: rev.clone(),
            },
        ] {
            assert_eq!(op.budget(), Budget::LocalMutation);
            assert!(op.is_mutation());
        }
        for op in [
            Operation::SetupConfigure {
                token: "abcd".into(),
            },
            Operation::CredentialsReplace {
                token: "abcd".into(),
            },
            Operation::ServiceStart,
            Operation::ServiceStop,
            Operation::ServiceRepair,
        ] {
            assert_eq!(op.budget(), Budget::ServiceMutation);
            assert!(op.is_mutation());
        }
        let policy = crate::process::Policy::default();
        assert_eq!(
            (
                policy.read.as_secs(),
                policy.local_mutation.as_secs(),
                policy.mutation.as_secs()
            ),
            (10, 15, 120)
        );
    }
    const WATCH: &str = r#"{"user":"alice","status":"active","interval_seconds":300,"last_ok":null,"waiting_first_check":true,"has_error":false,"consecutive_errors":0,"revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}"#;
    fn overview_json(watches: &str) -> String {
        format!(
            r#"{{"configured":true,"desired_service":"running","service_state":"unknown","quota_remaining":8,"quota_checked_at":100,"watches":[{watches}],"next_cursor":null}}"#
        )
    }
    #[test]
    fn overview_and_watch_pages_decode_strictly() {
        let good = decode(
            &envelope(&overview_json(WATCH)),
            "test",
            &Operation::Overview,
        )
        .unwrap();
        assert!(
            matches!(good, Response::Overview(ref o) if o.watches.len() == 1 && o.service_state == ServiceState::Unknown)
        );
        let unconfigured = r#"{"configured":false,"desired_service":null,"service_state":"unknown","quota_remaining":null,"quota_checked_at":null,"watches":[],"next_cursor":null}"#;
        assert!(decode(&envelope(unconfigured), "test", &Operation::Overview).is_ok());
        for bad in [
            overview_json(WATCH).replace(
                "\"service_state\":\"unknown\"",
                "\"service_state\":\"healthy\"",
            ),
            overview_json(WATCH).replace("\"quota_remaining\":8", "\"quota_remaining\":null"),
            overview_json(WATCH).replace(
                "\"quota_remaining\":8",
                "\"quota_remaining\":8,\"secret\":\"TOKEN_SENTINEL\"",
            ),
            overview_json(&WATCH.replace("\"last_ok\":null", "\"last_ok\":5")),
            overview_json(&WATCH.replace("\"user\":\"alice\"", "\"user\":\"Alice\"")),
            overview_json(&WATCH.replace("\"interval_seconds\":300", "\"interval_seconds\":299")),
            overview_json(&WATCH.replace(
                "\"consecutive_errors\":0",
                "\"consecutive_errors\":9007199254740992",
            )),
            overview_json(&WATCH.replace("\"revision\":\"0123", "\"revision\":\"ZZ23")),
            overview_json(&WATCH.replace("\"status\":\"active\"", "\"status\":\"deleted\"")),
            overview_json(&format!("{WATCH},{WATCH}")),
            overview_json(&WATCH.replace(
                "\"has_error\":false",
                "\"has_error\":false,\"last_error\":\"TOKEN_SENTINEL\"",
            )),
            unconfigured.replace("\"watches\":[]", &format!("\"watches\":[{WATCH}]")),
            unconfigured.replace(
                "\"service_state\":\"unknown\"",
                "\"service_state\":\"stopped\"",
            ),
            overview_json(
                &WATCH
                    .replace("\"last_ok\":null", "\"last_ok\":253402300800")
                    .replace(
                        "\"waiting_first_check\":true",
                        "\"waiting_first_check\":false",
                    ),
            ),
            overview_json(WATCH).replace(
                "\"quota_checked_at\":100",
                "\"quota_checked_at\":253402300800",
            ),
            overview_json(&WATCH.replace(
                "\"interval_seconds\":300",
                "\"interval_seconds\":2147483648",
            )),
            overview_json(&WATCH.replace("\"interval_seconds\":300", "\"interval_seconds\":300.0")),
            overview_json(&WATCH.replace("\"consecutive_errors\":0", "\"consecutive_errors\":-1")),
            overview_json(&WATCH.replace(
                "\"waiting_first_check\":true",
                "\"waiting_first_check\":false",
            )),
            unconfigured.replace(
                "\"desired_service\":null",
                "\"desired_service\":\"stopped\"",
            ),
        ] {
            assert_eq!(
                decode(&envelope(&bad), "test", &Operation::Overview).unwrap_err(),
                HostError::Protocol,
                "{bad}"
            );
        }
        let page = format!(
            r#"{{"items":[{WATCH},{}],"next_cursor":"w1.Ym9i"}}"#,
            WATCH.replace("alice", "bob")
        );
        let list = Operation::WatchesList {
            limit: None,
            cursor: None,
        };
        assert!(
            matches!(decode(&envelope(&page), "test", &list).unwrap(), Response::WatchPage(ref p) if p.items.len() == 2 && p.next_cursor.as_deref() == Some("w1.Ym9i"))
        );
        let items = |count: usize| {
            (0..count)
                .map(|i| WATCH.replace("alice", &format!("u{i:02}")))
                .collect::<Vec<_>>()
                .join(",")
        };
        let fifty = format!(r#"{{"items":[{}],"next_cursor":null}}"#, items(50));
        assert!(
            matches!(decode(&envelope(&fifty), "test", &list).unwrap(), Response::WatchPage(ref p) if p.items.len() == 50)
        );
        for bad in [
            page.replace(
                "\"next_cursor\":\"w1.Ym9i\"",
                "\"next_cursor\":\"bad cursor\"",
            ),
            page.replace("\"next_cursor\":\"w1.Ym9i\"", "\"next_cursor\":\"w1.\""),
            format!(r#"{{"items":[{}],"next_cursor":null}}"#, items(51)),
            page.replace(
                "\"next_cursor\":\"w1.Ym9i\"",
                "\"next_cursor\":null,\"scanned\":1",
            ),
            format!(
                r#"{{"items":[{},{WATCH}],"next_cursor":null}}"#,
                WATCH.replace("alice", "bob")
            ),
        ] {
            assert!(decode(&envelope(&bad), "test", &list).is_err(), "{bad}");
        }
    }
    #[test]
    fn watch_mutations_decode_only_their_own_user() {
        let add = Operation::WatchesAdd {
            user: "alice".into(),
            interval_seconds: None,
        };
        let wrapped = format!(r#"{{"watch":{WATCH}}}"#);
        assert!(
            matches!(decode(&envelope(&wrapped), "test", &add).unwrap(), Response::Watch(ref w) if w.user == "alice" && w.waiting_first_check)
        );
        assert!(decode(&envelope(&wrapped.replace("alice", "bob")), "test", &add).is_err());
        assert!(decode(&envelope(WATCH), "test", &add).is_err());
        let remove = Operation::WatchesRemove {
            user: "alice".into(),
            revision: "a".repeat(64),
        };
        assert!(
            matches!(decode(&envelope(r#"{"removed_user":"alice"}"#), "test", &remove).unwrap(), Response::Removed(ref r) if r.removed_user == "alice")
        );
        assert!(decode(&envelope(r#"{"removed_user":"bob"}"#), "test", &remove).is_err());
        assert!(decode(
            &envelope(r#"{"removed_user":"alice","watch":null}"#),
            "test",
            &remove
        )
        .is_err());
        assert!(decode(&envelope(WATCH), "test", &Operation::SetupInspect).is_err());
    }
    #[test]
    fn c2_error_codes_are_static() {
        for code in [
            "watch_conflict",
            "watch_not_found",
            "watch_exists",
            "watch_limit",
            "history_corrupt",
            "history_oversized",
            "snapshot_unavailable",
            "snapshot_identity_mismatch",
        ] {
            let raw = format!("{{\"protocol_version\":1,\"request_id\":\"test\",\"error\":{{\"code\":\"{code}\",\"message\":\"RAW_SENTINEL\",\"retryable\":true}}}}\n");
            let response = decode(raw.as_bytes(), "test", &Operation::Overview).unwrap();
            let safe = serde_json::to_string(&response).unwrap();
            assert!(
                safe.contains(code)
                    && !safe.contains("RAW_SENTINEL")
                    && safe.contains("\"retryable\":false")
            );
        }
        assert!(decode(b"{\"protocol_version\":1,\"request_id\":\"test\",\"error\":{\"code\":\"history_identity_unknown\",\"message\":\"x\",\"retryable\":false}}\n", "test", &Operation::Overview).is_err());
    }
    #[test]
    fn nested_watches_require_exact_keys() {
        let fields = [
            r#""user":"alice""#,
            r#""status":"active""#,
            r#""interval_seconds":300"#,
            r#""last_ok":null"#,
            r#""waiting_first_check":true"#,
            r#""has_error":false"#,
            r#""consecutive_errors":0"#,
            r#""revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef""#,
        ];
        let shapes = |watch: &str| -> [(Operation, String); 3] {
            [
                (Operation::Overview, overview_json(watch)),
                (
                    Operation::WatchesList {
                        limit: None,
                        cursor: None,
                    },
                    format!(r#"{{"items":[{watch}],"next_cursor":null}}"#),
                ),
                (
                    Operation::WatchesAdd {
                        user: "alice".into(),
                        interval_seconds: None,
                    },
                    format!(r#"{{"watch":{watch}}}"#),
                ),
            ]
        };
        let full = format!("{{{}}}", fields.join(","));
        for (operation, result) in shapes(&full) {
            assert!(
                decode(&envelope(&result), "test", &operation).is_ok(),
                "{result}"
            );
        }
        for missing in 0..fields.len() {
            let kept: Vec<&str> = fields
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != missing)
                .map(|(_, field)| *field)
                .collect();
            let watch = format!("{{{}}}", kept.join(","));
            for (operation, result) in shapes(&watch) {
                assert_eq!(
                    decode(&envelope(&result), "test", &operation).unwrap_err(),
                    HostError::Protocol,
                    "{result}"
                );
            }
        }
        let renamed = full.replace("\"last_ok\":null", "\"last_error\":null");
        for (operation, result) in shapes(&renamed) {
            assert_eq!(
                decode(&envelope(&result), "test", &operation).unwrap_err(),
                HostError::Protocol,
                "{result}"
            );
        }
    }
    #[test]
    fn production_watch_shape_is_accepted_everywhere() {
        const PRODUCTION: &str = r#"{"user":"alice","status":"paused","interval_seconds":2147483647,"last_ok":253402300799,"waiting_first_check":false,"has_error":true,"consecutive_errors":9007199254740991,"revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}"#;
        let check = |watch: &Watch| {
            assert_eq!(watch.user, "alice");
            assert_eq!(watch.status, WatchStatus::Paused);
            assert_eq!(watch.interval_seconds, 2_147_483_647);
            assert_eq!(watch.last_ok, Some(253_402_300_799));
            assert!(!watch.waiting_first_check);
            assert!(watch.has_error);
            assert_eq!(watch.consecutive_errors, 9_007_199_254_740_991);
            assert_eq!(
                watch.revision,
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            );
        };
        let overview = overview_json(&format!("{PRODUCTION},{}", WATCH.replace("alice", "bob")));
        match decode(&envelope(&overview), "test", &Operation::Overview).unwrap() {
            Response::Overview(overview) => {
                assert_eq!(overview.watches.len(), 2);
                check(&overview.watches[0]);
                assert_eq!(overview.watches[1].status, WatchStatus::Active);
            }
            other => panic!("{other:?}"),
        }
        let page = format!(r#"{{"items":[{PRODUCTION}],"next_cursor":"w1.YWxpY2U"}}"#);
        let list = Operation::WatchesList {
            limit: None,
            cursor: None,
        };
        match decode(&envelope(&page), "test", &list).unwrap() {
            Response::WatchPage(page) => {
                assert_eq!(page.items.len(), 1);
                assert_eq!(page.next_cursor.as_deref(), Some("w1.YWxpY2U"));
                check(&page.items[0]);
            }
            other => panic!("{other:?}"),
        }
        let pause = Operation::WatchesPause {
            user: "alice".into(),
            revision: "a".repeat(64),
        };
        let single = format!(r#"{{"watch":{PRODUCTION}}}"#);
        match decode(&envelope(&single), "test", &pause).unwrap() {
            Response::Watch(watch) => check(&watch),
            other => panic!("{other:?}"),
        }
        assert!(decode(&envelope(&single.replace("alice", "bob")), "test", &pause).is_err());
    }
    fn snap(id: u64, pk: &str, at: u64) -> String {
        format!(r#"{{"id":"{id}","target_pk":"{pk}","captured_at":{at}}}"#)
    }
    fn page(items: &[String], cursor: Option<&str>, scanned: u64) -> String {
        let cursor = cursor.map_or("null".to_owned(), |c| format!("\"{c}\""));
        format!(
            r#"{{"items":[{}],"next_cursor":{cursor},"scan_complete":{},"scanned":{scanned}}}"#,
            items.join(","),
            cursor == "null"
        )
    }
    #[test]
    fn history_pages_validate_kinds_order_and_filters() {
        let targets = Operation::SnapshotsTargets {
            username: "alice".into(),
            limit: None,
            cursor: None,
        };
        let items = [
            format!(
                r#"{{"kind":"target","target_pk":"8","snapshot":{}}}"#,
                snap(3, "8", 3)
            ),
            format!(
                r#"{{"kind":"target","target_pk":"7","snapshot":{}}}"#,
                snap(2, "7", 2)
            ),
            format!(
                r#"{{"kind":"diagnostic","snapshot":{},"code":"history_identity_unknown"}}"#,
                snap(1, "9", 1)
            ),
        ];
        let good = decode(&envelope(&page(&items, None, 3)), "test", &targets).unwrap();
        assert!(
            matches!(good, Response::HistoryPage(ref p) if p.items.len() == 3 && p.scan_complete && p.scanned == 3)
        );
        let with_cursor = page(&items, Some("eyJ2IjoxfQ"), 3);
        assert!(
            matches!(decode(&envelope(&with_cursor), "test", &targets).unwrap(), Response::HistoryPage(ref p) if !p.scan_complete)
        );
        for bad in [
            page(&[items[1].clone(), items[0].clone()], None, 2),
            page(&items, None, 3).replace("\"scan_complete\":true", "\"scan_complete\":false"),
            page(&items, None, 2001),
            page(
                &[format!(
                    r#"{{"kind":"target","target_pk":"9","snapshot":{}}}"#,
                    snap(3, "8", 3)
                )],
                None,
                1,
            ),
            page(
                &[format!(
                    r#"{{"kind":"snapshot","snapshot":{}}}"#,
                    snap(3, "8", 3)
                )],
                None,
                1,
            ),
            page(
                &[format!(
                    r#"{{"kind":"target","target_pk":"8","snapshot":{},"extra":1}}"#,
                    snap(3, "8", 3)
                )],
                None,
                1,
            ),
            page(
                &[format!(
                    r#"{{"kind":"target","target_pk":"8","snapshot":{}}}"#,
                    snap(3, "8", 253402300800)
                )],
                None,
                1,
            ),
            page(
                &[format!(
                    r#"{{"kind":"target","target_pk":"8","snapshot":{}}}"#,
                    snap(3, "8", 3).replace("\"3\"", "\"03\"")
                )],
                None,
                1,
            ),
        ] {
            assert!(decode(&envelope(&bad), "test", &targets).is_err(), "{bad}");
        }
        let list = Operation::SnapshotsList {
            target_pk: "7".into(),
            limit: Some(1),
            cursor: None,
        };
        let snapshots = [format!(
            r#"{{"kind":"snapshot","snapshot":{}}}"#,
            snap(2, "7", 2)
        )];
        assert!(decode(&envelope(&page(&snapshots, Some("abc"), 1)), "test", &list).is_ok());
        assert!(decode(
            &envelope(&page(
                &[format!(
                    r#"{{"kind":"snapshot","snapshot":{}}}"#,
                    snap(2, "8", 2)
                )],
                None,
                1
            )),
            "test",
            &list
        )
        .is_err());
        assert!(decode(
            &envelope(&page(
                &[
                    snapshots[0].clone(),
                    format!(r#"{{"kind":"snapshot","snapshot":{}}}"#, snap(1, "7", 1))
                ],
                None,
                2
            )),
            "test",
            &list
        )
        .is_err());
    }
    #[test]
    fn feed_and_comparison_values_are_bounded() {
        let comparison = format!(
            r#"{{"kind":"comparison","older":{},"newer":{},"changes":[{{"field":"follower_count","old":1,"new":2}},{{"field":"biography","old":null,"new":"x"}},{{"field":"avatar","old":null,"new":"{}"}}],"unknown_fields":[]}}"#,
            snap(1, "7", 1),
            snap(2, "7", 2),
            "a".repeat(64)
        );
        let feed = Operation::ChangesList {
            target_pk: None,
            limit: None,
            cursor: None,
        };
        let baseline = format!(r#"{{"kind":"baseline","snapshot":{}}}"#, snap(1, "7", 1));
        let incomplete = format!(
            r#"{{"kind":"incomplete","older":{},"newer":{},"changes":[],"unknown_fields":["full_name"]}}"#,
            snap(2, "7", 2),
            snap(3, "7", 3)
        );
        let good = page(
            &[incomplete.clone(), comparison.clone(), baseline.clone()],
            None,
            3,
        );
        assert!(
            matches!(decode(&envelope(&good), "test", &feed).unwrap(), Response::HistoryPage(ref p) if p.items.len() == 3)
        );
        for bad in [
            comparison.replace("\"old\":1,\"new\":2", "\"old\":1.5,\"new\":2"),
            comparison.replace("\"old\":1,\"new\":2", "\"old\":-1,\"new\":2"),
            comparison.replace("\"old\":1,\"new\":2", "\"old\":9007199254740992,\"new\":2"),
            comparison.replace("\"old\":1,\"new\":2", "\"old\":{},\"new\":2"),
            comparison.replace(
                "\"field\":\"follower_count\"",
                "\"field\":\"Follower Count\"",
            ),
            comparison.replace(
                "\"unknown_fields\":[]",
                "\"unknown_fields\":[\"full_name\"]",
            ),
            comparison.replace("\"changes\":[", "\"note\":\"RAW\",\"changes\":["),
            comparison.replace(&snap(2, "7", 2), &snap(2, "8", 2)),
            comparison.replace(&snap(2, "7", 2), &snap(2, "7", 0)),
            incomplete.replace("[\"full_name\"]", "[]"),
            format!(
                r#"{{"kind":"comparison","older":{},"newer":{},"changes":[],"unknown_fields":[]}}"#,
                snap(1, "7", 1),
                snap(2, "7", 2)
            ),
        ] {
            assert!(
                decode(
                    &envelope(&page(std::slice::from_ref(&bad), None, 1)),
                    "test",
                    &feed
                )
                .is_err(),
                "{bad}"
            );
        }
        let filtered = Operation::ChangesList {
            target_pk: Some("8".into()),
            limit: None,
            cursor: None,
        };
        assert!(decode(
            &envelope(&page(std::slice::from_ref(&baseline), None, 1)),
            "test",
            &filtered
        )
        .is_err());
        let compare = Operation::SnapshotsCompare {
            target_pk: "7".into(),
            older_id: "1".into(),
            newer_id: "2".into(),
        };
        let bare = comparison.replace(
            "\"unknown_fields\":[]",
            "\"unknown_fields\":[\"full_name\"]",
        );
        assert!(
            matches!(decode(&envelope(&bare), "test", &compare).unwrap(), Response::Comparison(ref c) if c.changes.len() == 3 && c.unknown_fields == ["full_name"])
        );
        assert!(decode(
            &envelope(&format!(
                r#"{{"kind":"comparison","older":{},"newer":{},"changes":[],"unknown_fields":[]}}"#,
                snap(1, "7", 1),
                snap(2, "7", 2)
            )),
            "test",
            &compare
        )
        .is_ok());
        assert!(decode(
            &envelope(&comparison.replace(&snap(1, "7", 1), &snap(5, "7", 1))),
            "test",
            &compare
        )
        .is_err());
        // Same second, increasing id: a valid pair (order is the (captured_at,id) tuple).
        assert!(decode(
            &envelope(&comparison.replace(&snap(1, "7", 1), &snap(1, "7", 2))),
            "test",
            &compare
        )
        .is_ok());
        assert!(decode(
            &envelope(&comparison.replace("\"kind\":\"comparison\"", "\"kind\":\"incomplete\"")),
            "test",
            &compare
        )
        .is_err());
        let serialized =
            serde_json::to_string(&decode(&envelope(&good), "test", &feed).unwrap()).unwrap();
        assert!(
            serialized.contains("\"kind\":\"history_page\"")
                && serialized.contains("\"kind\":\"incomplete\"")
                && serialized.contains("\"kind\":\"baseline\"")
        );
    }
    #[test]
    fn snapshot_fields_are_bounded_like_the_comparison_values() {
        let read = Operation::SnapshotsRead {
            target_pk: "7".into(),
            snapshot_id: "2".into(),
        };
        let good = format!(
            r#"{{"kind":"snapshot_fields","snapshot":{},"fields":{{"username":"alice","biography":"x","external_url":null,"is_verified":false,"follower_count":18507,"avatar":"{}","banner":null}},"unknown_fields":["full_name"]}}"#,
            snap(2, "7", 2),
            "a".repeat(64)
        );
        let decoded = decode(&envelope(&good), "test", &read).unwrap();
        assert!(
            matches!(decoded, Response::SnapshotFields(ref f) if f.snapshot.id == "2"
                && f.fields.len() == 7
                && matches!(f.fields["follower_count"], ChangeValue::Integer(18507))
                && matches!(f.fields["is_verified"], ChangeValue::Bool(false))
                && matches!(f.fields["external_url"], ChangeValue::Null)
                && f.unknown_fields == ["full_name"])
        );
        // The window receives the same object shape the core sent.
        let serialized = serde_json::to_string(&decoded).unwrap();
        assert!(
            serialized.contains("\"kind\":\"snapshot_fields\"")
                && serialized.contains("\"external_url\":null")
                && serialized.contains("\"follower_count\":18507")
        );
        // An empty snapshot is a legitimate answer: every tracked field unknown.
        assert!(decode(
            &envelope(&format!(
                r#"{{"kind":"snapshot_fields","snapshot":{},"fields":{{}},"unknown_fields":[]}}"#,
                snap(2, "7", 2)
            )),
            "test",
            &read
        )
        .is_ok());
        for bad in [
            // The same value bounds the change values get.
            good.replace("18507", "18507.5"),
            good.replace("18507", "-1"),
            good.replace("18507", "9007199254740992"),
            good.replace("18507", "[1]"),
            good.replace("\"username\"", "\"Username\""),
            good.replace("\"full_name\"", "\"Full Name\""),
            // A field cannot be both known and unknown.
            good.replace("\"full_name\"", "\"username\""),
            // The envelope's key set and kind are exact.
            good.replace("\"fields\":", "\"note\":1,\"fields\":"),
            good.replace(",\"unknown_fields\":[\"full_name\"]", ""),
            good.replace("\"kind\":\"snapshot_fields\"", "\"kind\":\"comparison\""),
            good.replace("\"fields\":{", "\"fields\":[{"),
            // The answer must be the snapshot that was asked for.
            good.replace(&snap(2, "7", 2), &snap(3, "7", 2)),
            good.replace(&snap(2, "7", 2), &snap(2, "8", 2)),
        ] {
            assert!(decode(&envelope(&bad), "test", &read).is_err(), "{bad}");
        }
    }
    #[test]
    fn change_value_null_serializes_as_json_null() {
        assert_eq!(serde_json::to_string(&ChangeValue::Null).unwrap(), "null");
        assert_eq!(
            serde_json::to_string(&ChangeValue::Bool(true)).unwrap(),
            "true"
        );
        assert_eq!(
            serde_json::to_string(&ChangeValue::Integer(MAX_SAFE)).unwrap(),
            "9007199254740991"
        );
        assert_eq!(
            serde_json::to_string(&ChangeValue::Text("x".into())).unwrap(),
            "\"x\""
        );
    }
    #[test]
    fn c3_requests_and_budgets() {
        use crate::protocol::Budget;
        let cases: Vec<(Operation, &str)> = vec![
            (
                Operation::ServiceInspect,
                r#""operation":"service.inspect","params":{}"#,
            ),
            (
                Operation::ServiceMigrate,
                r#""operation":"service.migrate","params":{}"#,
            ),
            (
                Operation::ServiceUninstall,
                r#""operation":"service.uninstall","params":{}"#,
            ),
            (
                Operation::HomeInspect {
                    path: "~/.insto".into(),
                },
                r#""operation":"home.inspect","params":{"path":"~/.insto"}"#,
            ),
            (
                Operation::HomeSelect {
                    path: Some("/Users/x/.insto".into()),
                },
                r#""operation":"home.select","params":{"path":"/Users/x/.insto"}"#,
            ),
            (
                Operation::HomeSelect { path: None },
                r#""operation":"home.select","params":{"path":null}"#,
            ),
        ];
        for (operation, expected) in cases {
            let text = String::from_utf8(operation.request("test").unwrap()).unwrap();
            assert!(text.contains(expected), "{text}");
            assert!(text.ends_with("}\n"));
        }
        for operation in [
            Operation::ServiceInspect,
            Operation::HomeInspect { path: "~".into() },
        ] {
            assert_eq!(operation.budget(), Budget::Read);
            assert!(!operation.is_mutation());
        }
        for operation in [
            Operation::ServiceMigrate,
            Operation::ServiceUninstall,
            Operation::HomeSelect { path: None },
        ] {
            assert_eq!(operation.budget(), Budget::ServiceMutation);
            assert!(operation.is_mutation());
        }
        assert_eq!(
            format!(
                "{:?}",
                Operation::HomeInspect {
                    path: "/secret_sentinel".into()
                }
            ),
            "home.inspect"
        );
    }
    #[test]
    fn c3_home_paths_match_the_core_bounds() {
        let longest = format!("/{}", "a".repeat(PATH_LIMIT_BYTES - 1));
        for path in [
            "/",
            "/Users/x/.insto",
            "~",
            "~/.insto",
            "~/a b/c",
            "/Users/x/..hidden",
            longest.as_str(),
        ] {
            assert_eq!(
                Operation::HomeInspect { path: path.into() }.validate(),
                Ok(()),
                "{path}"
            );
            assert_eq!(
                Operation::HomeSelect {
                    path: Some(path.into())
                }
                .validate(),
                Ok(()),
                "{path}"
            );
        }
        let too_long = format!("/{}", "a".repeat(PATH_LIMIT_BYTES));
        let too_wide = format!("/{}", "é".repeat(PATH_LIMIT_BYTES / 2));
        for path in [
            "",
            "relative/.insto",
            "~user/.insto",
            "~~/.insto",
            "/Users/x/../y",
            "/..",
            "..",
            "/Users/x/.insto/..",
            "/Users/x/\u{0}/.insto",
            too_long.as_str(),
            too_wide.as_str(),
        ] {
            assert_eq!(
                Operation::HomeInspect { path: path.into() }.validate(),
                Err(HostError::InvalidParams),
                "{path}"
            );
            assert_eq!(
                Operation::HomeInspect { path: path.into() }.request("id"),
                Err(HostError::InvalidParams),
                "{path}"
            );
            assert_eq!(
                Operation::HomeSelect {
                    path: Some(path.into())
                }
                .validate(),
                Err(HostError::InvalidParams),
                "{path}"
            );
        }
        assert_eq!(Operation::HomeSelect { path: None }.validate(), Ok(()));
        assert_eq!(Operation::ServiceMigrate.validate(), Ok(()));
    }
    #[test]
    fn c3_response_paths_use_the_expanded_bound() {
        // The core expands `~` before it answers, so a path it reports back can be
        // longer than the 1024-byte request bound. Only PATH_MAX still applies.
        let expanded = format!("/Users/x/{}/.insto", "d".repeat(1200));
        let longest = format!("/{}", "a".repeat(RESPONSE_PATH_LIMIT_BYTES - 1));
        assert!(expanded.len() > PATH_LIMIT_BYTES);
        for path in ["/", "/Users/x/.insto", expanded.as_str(), longest.as_str()] {
            assert!(response_path_ok(path), "{path}");
        }
        let too_long = format!("/{}", "a".repeat(RESPONSE_PATH_LIMIT_BYTES));
        let too_wide = format!("/{}", "é".repeat(RESPONSE_PATH_LIMIT_BYTES / 2));
        for path in [
            "",
            "~",
            "~/.insto",
            "relative/.insto",
            "/Users/x/\u{0}/.insto",
            too_long.as_str(),
            too_wide.as_str(),
        ] {
            assert!(!response_path_ok(path), "{path}");
        }
        // The request bound stays the tighter of the two.
        assert!(!home_path_ok(&expanded));
        assert!(home_path_ok("~/.insto") && !response_path_ok("~/.insto"));
    }
    #[test]
    fn c3_error_codes_are_static() {
        for code in [
            "home_invalid",
            "home_backend_unsupported",
            "service_ownership_unknown",
            "service_config_mismatch",
        ] {
            let raw = format!(
                "{{\"protocol_version\":1,\"request_id\":\"test\",\"error\":{{\"code\":\"{code}\",\"message\":\"/Users/x/.insto TOKEN_SENTINEL\",\"retryable\":true}}}}\n"
            );
            let Response::Error(error) = decode(
                raw.as_bytes(),
                "test",
                &Operation::HomeSelect { path: None },
            )
            .unwrap() else {
                panic!("expected an error response for {code}");
            };
            assert_eq!(error.code, code);
            assert!(!error.retryable, "{code} must not be retryable");
            assert!(!error.message.contains("TOKEN_SENTINEL") && !error.message.contains("/Users"));
        }
    }
    #[test]
    fn adopted_profiles_report_null_quota_while_configured() {
        let adopted = r#"{"configured":true,"status":"stopped","desired_service":"stopped","service_running":false,"quota_remaining":null,"quota_checked_at":null,"revision":"0123456789abcdef0123456789abcdef"}"#;
        for operation in [
            Operation::SetupInspect,
            Operation::ServiceMigrate,
            Operation::ServiceUninstall,
            Operation::HomeSelect {
                path: Some("~/.insto".into()),
            },
        ] {
            assert!(
                decode(&envelope(adopted), "test", &operation).is_ok(),
                "{operation:?}"
            );
        }
        let running = adopted
            .replace("\"status\":\"stopped\"", "\"status\":\"running\"")
            .replace("\"service_running\":false", "\"service_running\":true")
            .replace(
                "\"desired_service\":\"stopped\"",
                "\"desired_service\":\"running\"",
            );
        assert!(decode(&envelope(&running), "test", &Operation::SetupInspect).is_ok());
        for bad in [
            // `quota_exhausted` still demands a saved zero, never an unknown quota.
            adopted.replace("\"status\":\"stopped\"", "\"status\":\"quota_exhausted\""),
            // The two quota fields are written together: never one of each.
            adopted.replace("\"quota_remaining\":null", "\"quota_remaining\":5"),
            adopted.replace("\"quota_checked_at\":null", "\"quota_checked_at\":5"),
            // `desired_service` and `revision` stay tied to `configured`.
            adopted.replace(
                "\"desired_service\":\"stopped\"",
                "\"desired_service\":null",
            ),
            adopted.replace(
                "\"revision\":\"0123456789abcdef0123456789abcdef\"",
                "\"revision\":null",
            ),
            // An unconfigured profile still carries no quota at all.
            adopted
                .replace("\"configured\":true", "\"configured\":false")
                .replace("\"status\":\"stopped\"", "\"status\":\"unconfigured\"")
                .replace(
                    "\"desired_service\":\"stopped\"",
                    "\"desired_service\":null",
                )
                .replace(
                    "\"revision\":\"0123456789abcdef0123456789abcdef\"",
                    "\"revision\":null",
                )
                .replace("\"quota_remaining\":null", "\"quota_remaining\":5")
                .replace("\"quota_checked_at\":null", "\"quota_checked_at\":5"),
        ] {
            assert!(
                decode(&envelope(&bad), "test", &Operation::SetupInspect).is_err(),
                "{bad}"
            );
        }
        let zero = adopted
            .replace("\"quota_remaining\":null", "\"quota_remaining\":0")
            .replace("\"quota_checked_at\":null", "\"quota_checked_at\":1")
            .replace("\"status\":\"stopped\"", "\"status\":\"quota_exhausted\"");
        assert!(decode(&envelope(&zero), "test", &Operation::SetupInspect).is_ok());
    }
    #[test]
    fn adopted_overviews_report_null_quota_while_configured() {
        let adopted = overview_json(WATCH)
            .replace("\"quota_remaining\":8", "\"quota_remaining\":null")
            .replace("\"quota_checked_at\":100", "\"quota_checked_at\":null");
        assert!(decode(&envelope(&adopted), "test", &Operation::Overview).is_ok());
        for bad in [
            // One half of the pair without the other is not a core shape.
            adopted.replace("\"quota_checked_at\":null", "\"quota_checked_at\":100"),
            adopted.replace("\"quota_remaining\":null", "\"quota_remaining\":8"),
            // An unconfigured overview still reports no quota at all.
            r#"{"configured":false,"desired_service":null,"service_state":"unknown","quota_remaining":0,"quota_checked_at":null,"watches":[],"next_cursor":null}"#.to_owned(),
        ] {
            assert_eq!(
                decode(&envelope(&bad), "test", &Operation::Overview).unwrap_err(),
                HostError::Protocol,
                "{bad}"
            );
        }
    }
    // The shared fixture table. Task 6 (`src/desktop/dto.test.ts`) and Task 9
    // (`c3_bridge.rs`) reuse these numbers.
    const F1: &str = r#"{"registration":"none","interpreter":null,"interpreter_exists":null,"loaded":null,"settings":null}"#;
    const F3: &str = r#"{"registration":"owned","interpreter":"other","interpreter_exists":true,"loaded":true,"settings":"matching"}"#;
    const F4: &str = r#"{"registration":"owned","interpreter":"current","interpreter_exists":true,"loaded":false,"settings":null}"#;
    const F5: &str = r#"{"registration":"unknown","interpreter":null,"interpreter_exists":null,"loaded":true,"settings":null}"#;
    const F7: &str = r#"{"path":"/Users/x/.insto","exists":true,"private":true,"config":"ok","backend":"hikerapi","database":"ok","registration":"none","interpreter":null,"loaded":false,"process":"stopped","adoptable":true,"reason":null}"#;
    const F8: &str = r#"{"path":"/Users/x/none","exists":false,"private":false,"config":"missing","backend":null,"database":"missing","registration":"none","interpreter":null,"loaded":null,"process":"unknown","adoptable":false,"reason":"home_invalid"}"#;
    const F9: &str = r#"{"path":"/Users/x/open","exists":true,"private":false,"config":"invalid","backend":null,"database":"unreadable","registration":"unknown","interpreter":null,"loaded":null,"process":"unknown","adoptable":false,"reason":"home_invalid"}"#;
    const F10: &str = r#"{"path":"/Users/x/.insto","exists":true,"private":true,"config":"invalid","backend":"hikerapi","database":"ok","registration":"none","interpreter":null,"loaded":false,"process":"stopped","adoptable":false,"reason":"home_invalid"}"#;
    const F11: &str = r#"{"path":"/Users/x/.insto","exists":true,"private":true,"config":"ok","backend":"hikerapi","database":"schema_mismatch","registration":"none","interpreter":null,"loaded":false,"process":"stopped","adoptable":false,"reason":"schema_mismatch"}"#;
    const F12: &str = r#"{"path":"/Users/x/.insto","exists":true,"private":true,"config":"ok","backend":"hikerapi","database":"ok","registration":"owned","interpreter":"other","loaded":true,"process":"running","adoptable":true,"reason":null}"#;

    #[test]
    fn c3_service_inspection_accepts_exactly_the_core_shapes() {
        let facts = |body: &str| decode(&envelope(body), "test", &Operation::ServiceInspect);
        let Ok(Response::ServiceInspection(owned)) = facts(F3) else {
            panic!("F3 must decode");
        };
        assert_eq!(owned.registration, Registration::Owned);
        assert_eq!(owned.interpreter, Some(Interpreter::Other));
        assert_eq!(owned.interpreter_exists, Some(true));
        assert_eq!(owned.loaded, Some(true));
        assert_eq!(owned.settings, Some(Settings::Matching));
        for accepted in [
            F1.to_owned(),
            F1.replace("\"loaded\":null", "\"loaded\":false"), // F2
            F3.into(),
            F4.into(),
            F5.into(),
        ] {
            assert!(facts(&accepted).is_ok(), "{accepted}");
        }
        for rejected in [
            // F6: a loaded job forces `unknown`, so `none` is never loaded.
            F1.replace("\"loaded\":null", "\"loaded\":true"),
            // F6: an owned registration always names its interpreter.
            F3.replace("\"interpreter\":\"other\"", "\"interpreter\":null"),
            // F6: settings are compared only for an owned registration.
            F5.replace("\"settings\":null", "\"settings\":\"matching\""),
            // Interpreter facts come as a pair, and only when owned.
            F3.replace("\"interpreter_exists\":true", "\"interpreter_exists\":null"),
            F5.replace("\"interpreter\":null", "\"interpreter\":\"current\""),
            // Exactly the five keys, exactly the core's words for them.
            F3.replace(",\"settings\":\"matching\"", ""),
            F3.replace("\"loaded\":true", "\"loaded\":true,\"process\":\"running\""),
            F3.replace("\"settings\":\"matching\"", "\"settings\":\"unexpected\""),
            F3.replace(
                "\"registration\":\"owned\"",
                "\"registration\":\"installed\"",
            ),
        ] {
            assert_eq!(
                facts(&rejected).unwrap_err(),
                HostError::Protocol,
                "{rejected}"
            );
        }
    }
    #[test]
    fn c3_home_inspection_accepts_exactly_the_core_shapes() {
        let home = || Operation::HomeInspect {
            path: "~/.insto".into(),
        };
        let report = |body: &str| decode(&envelope(body), "test", &home());
        let Ok(Response::HomeInspection(adoptable)) = report(F7) else {
            panic!("F7 must decode");
        };
        assert!(adoptable.adoptable && adoptable.reason.is_none());
        assert_eq!(adoptable.path, "/Users/x/.insto");
        assert_eq!(adoptable.config, ConfigState::Ok);
        assert_eq!(adoptable.backend, Some(Backend::Hikerapi));
        assert_eq!(adoptable.database, DatabaseState::Ok);
        assert_eq!(adoptable.registration, Registration::None);
        assert_eq!(adoptable.process, ProcessState::Stopped);
        let Ok(Response::HomeInspection(refused)) = report(F11) else {
            panic!("F11 must decode");
        };
        assert_eq!(refused.reason, Some(Reason::SchemaMismatch));
        for accepted in [
            F7.to_owned(),
            F8.into(),
            F9.into(),
            F10.into(),
            F11.into(),
            F12.into(),
            // An aiograpi home: described in full, refused for adoption.
            F7.replace("\"backend\":\"hikerapi\"", "\"backend\":\"aiograpi\"")
                .replace("\"adoptable\":true", "\"adoptable\":false")
                .replace("\"reason\":null", "\"reason\":\"home_backend_unsupported\""),
            // A `~` the core expanded past the 1024-byte request bound.
            F7.replace(
                "/Users/x/.insto",
                &format!("/Users/x/{}/.insto", "d".repeat(1200)),
            ),
            // A staged home whose database is not there yet is still adoptable.
            F7.replace("\"database\":\"ok\"", "\"database\":\"missing\""),
        ] {
            assert!(report(&accepted).is_ok(), "{accepted}");
        }
        for rejected in [
            // F13: the verdict and its reason are one decision in the core.
            F11.replace("\"adoptable\":false", "\"adoptable\":true"),
            // F13: an unloaded job is `stopped`, never `running`.
            F7.replace("\"process\":\"stopped\"", "\"process\":\"running\""),
            // F13: nothing inside a missing home is read, so it is never private.
            F8.replace("\"private\":false", "\"private\":true"),
            // A refused reason implies the state that produced it.
            F11.replace("\"database\":\"schema_mismatch\"", "\"database\":\"ok\""),
            F11.replace(
                "\"reason\":\"schema_mismatch\"",
                "\"reason\":\"internal_error\"",
            ),
            // Adoptable means private, hikerapi and a usable database.
            F7.replace("\"database\":\"ok\"", "\"database\":\"unreadable\""),
            F7.replace("\"backend\":\"hikerapi\"", "\"backend\":\"fake\""),
            // Registration facts stay tied to the registration.
            F7.replace("\"registration\":\"none\"", "\"registration\":\"owned\""),
            F12.replace("\"registration\":\"owned\"", "\"registration\":\"unknown\""),
            F7.replace("\"loaded\":false", "\"loaded\":true"),
            // The response path is absolute, NUL-free and within PATH_MAX.
            F7.replace("\"/Users/x/.insto\"", "\"~/.insto\""),
            F7.replace("\"/Users/x/.insto\"", "\"/Users/x/\\u0000/.insto\""),
            // Exactly the twelve keys, exactly the core's words for them.
            F7.replace(",\"reason\":null", ""),
            F7.replace("\"exists\":true", "\"exists\":true,\"owner_uid\":501"),
            F7.replace("\"process\":\"stopped\"", "\"process\":\"launching\""),
        ] {
            assert_eq!(
                report(&rejected).unwrap_err(),
                HostError::Protocol,
                "{rejected}"
            );
        }
    }
}

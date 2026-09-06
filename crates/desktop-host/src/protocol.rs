use crate::HostError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const MAX_REQUEST: usize = 64 * 1024;
pub const MAX_RESPONSE: usize = 2 * 1024 * 1024;
pub const CORE_VERSION: &str = "0.7.21";
pub const CAPABILITIES: [&str; 19] = [
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
    "changes.list",
];
pub enum Operation {
    Hello,
    SetupInspect,
    SettingsInspect,
    SetupConfigure { token: String },
    CredentialsReplace { token: String },
    ServiceStart,
    ServiceStop,
    ServiceRepair,
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
#[derive(Debug, Serialize)]
pub struct SafeError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
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
        }
    }
    pub fn is_mutation(&self) -> bool {
        !matches!(
            self,
            Self::Hello | Self::SetupInspect | Self::SettingsInspect
        )
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
        #[derive(Serialize)]
        struct Request<'a> {
            protocol_version: u8,
            request_id: &'a str,
            operation: &'a str,
            params: Value,
        }
        let params = match self {
            Self::SetupConfigure { token } | Self::CredentialsReplace { token } => {
                if !(4..=4096).contains(&token.len())
                    || !token.bytes().all(|b| (33..=126).contains(&b))
                {
                    return Err(HostError::InvalidToken);
                }
                serde_json::json!({"token":token})
            }
            _ => serde_json::json!({}),
        };
        let mut bytes = serde_json::to_vec(&Request {
            protocol_version: 1,
            request_id: id,
            operation: self.name(),
            params,
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
        if matches!(operation, Operation::Hello) {
            let hello: Hello = serde_json::from_value(result.clone()).map_err(|_| bad())?;
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
                return Err(bad());
            }
            return Ok(Response::Hello(hello));
        }
        if result.as_object().map(|o| o.len()) != Some(7) {
            return Err(bad());
        }
        let profile: Profile = serde_json::from_value(result.clone()).map_err(|_| bad())?;
        if let Some(revision) = &profile.revision {
            if revision.len() != 32
                || !revision
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(bad());
            }
        }
        let fields = [
            profile.desired_service.is_some(),
            profile.quota_remaining.is_some(),
            profile.quota_checked_at.is_some(),
            profile.revision.is_some(),
        ];
        if !fields.iter().all(|present| *present == profile.configured) {
            return Err(bad());
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
            return Err(bad());
        }
        return Ok(Response::Profile(profile));
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
        "unsupported_platform" => (
            "unsupported_platform",
            "Desktop service management requires macOS.",
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
    const HELLO: &str = r#"{"core_version":"0.7.21","schema_version_supported":2,"capabilities":["hello","setup.inspect","setup.configure","settings.inspect","credentials.replace","service.start","service.stop","service.repair","overview","watches.list","watches.add","watches.update","watches.pause","watches.resume","watches.remove","snapshots.targets","snapshots.list","snapshots.compare","changes.list"]}"#;
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
}

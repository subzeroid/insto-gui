#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HostError {
    InvalidToken,
    InvalidParams,
    Protocol,
    Transport,
    OutcomeUnknown,
    Busy,
    Closed,
    Launcher,
    #[doc(hidden)]
    CleanupUnconfirmed,
}
impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidToken => "The token format is invalid.",
            Self::InvalidParams => "The operation parameters are invalid.",
            Self::Protocol => "The desktop response is incompatible.",
            Self::Transport => "The desktop operation did not complete.",
            Self::OutcomeUnknown => "Operation outcome is unknown; inspect state before retrying.",
            Self::Busy => "Another desktop operation is in progress.",
            Self::Closed => "The desktop host is closing.",
            Self::Launcher => "The desktop runtime could not be opened safely.",
            Self::CleanupUnconfirmed => "Desktop process cleanup could not be confirmed.",
        })
    }
}
impl std::error::Error for HostError {}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_outcome_is_explicit_and_actionable() {
        assert_eq!(
            HostError::OutcomeUnknown.to_string(),
            "Operation outcome is unknown; inspect state before retrying."
        );
    }
}

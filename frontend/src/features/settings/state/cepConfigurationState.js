import { setCepActivationDraft } from "./cepActivation.js";

const CONFIGURATION_FIELDS = [
  "provider_name",
  "url_template",
  "method",
  "field_map",
  "auth_header",
  "auth_prefix",
  "is_active",
];

function sameFieldMap(left = {}, right = {}) {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function hasCepConfigurationChanges(draft, confirmed) {
  if (!draft || !confirmed) return false;
  return CONFIGURATION_FIELDS.some((field) => (
    field === "field_map"
      ? !sameFieldMap(draft[field], confirmed[field])
      : draft[field] !== confirmed[field]
  ));
}

export function cepConfigurationReducer(state, action) {
  switch (action.type) {
    case "load":
      return { confirmed: action.configuration, draft: action.configuration };
    case "edit":
      return { ...state, draft: action.update(state.draft) };
    case "activation-edit":
      return { ...state, draft: setCepActivationDraft(state.draft, action.isActive) };
    case "confirmed-status": {
      const draftMatchesConfirmed = !state.confirmed
        || state.draft.is_active === state.confirmed.is_active;
      const confirmed = state.confirmed
        ? { ...state.confirmed, is_active: action.isActive }
        : null;
      return {
        confirmed,
        draft: draftMatchesConfirmed
          ? { ...state.draft, is_active: action.isActive }
          : state.draft,
      };
    }
    case "save-success":
      return { confirmed: action.configuration, draft: action.configuration };
    case "save-failure":
    default:
      return state;
  }
}

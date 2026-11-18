import ProfileEditFeature from "./ProfileEditFeature";
import ProfileFormFeature from "./ProfileFormFeature";
import ProfileListFeature from "./ProfileListFeature";
import Profiles from "./components/Profiles";
import useProfiles from "./hooks/useProfiles";

export default function ProfilesFeature({ view = "consultar", onViewChange }) {
  const profiles = useProfiles({ view, onViewChange });
  const content = profiles.creating ? (
    <>
      {profiles.message && <p className="profiles__success" role="status">{profiles.message}</p>}
      <ProfileFormFeature onSaved={() => profiles.handleSaved()} onCancel={() => onViewChange("consultar")} />
    </>
  ) : profiles.editing ? (
    <ProfileEditFeature key={profiles.editingId} profileId={profiles.editingId}
      onSaved={() => profiles.handleSaved(true)} onCancel={profiles.resetEditing}
      canEditPermissions={profiles.canEdit} />
  ) : (
    <>
      {profiles.message && <p className="profiles__success" role="status">{profiles.message}</p>}
      <ProfileListFeature key={profiles.reload} onEdit={profiles.onEdit} canEdit={profiles.canEdit} />
    </>
  );

  return <Profiles creating={profiles.creating} editing={profiles.editing}>
    {content}
  </Profiles>;
}

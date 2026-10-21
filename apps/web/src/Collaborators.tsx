import type { LivePerson } from "@travel-planner/shared";
import { UserRound } from "lucide-react";
import { useT } from "./preferences";

const SHOWN = 3;

// Who else has the Trip open (design 01: small avatars with an online dot, left of the help button; only initials, never emails).
export function Collaborators({ people }: { people: LivePerson[] }) {
  const t = useT();
  if (people.length === 0) return null;
  const shown = people.slice(0, SHOWN);
  const more = people.length - shown.length;
  return (
    <ul className="collaborators" aria-label={t("live.online")}>
      {shown.map((person) => (
        <li key={person.id} className="collaborator" aria-label={person.initial ?? t("live.guest")}>
          <span className="avatar small" aria-hidden="true">
            {person.initial ?? <UserRound size={14} />}
          </span>
          <span className="online-dot" aria-hidden="true" />
        </li>
      ))}
      {more > 0 && (
        <li className="collaborator more">
          +{more}
        </li>
      )}
    </ul>
  );
}

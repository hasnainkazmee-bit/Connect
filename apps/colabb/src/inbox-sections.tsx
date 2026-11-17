import { Link } from "react-router-dom";
import { BriefcaseBusiness, Building2 } from "lucide-react";
import { useApp } from "./context";
import "./brand/inbox-sections.css";

export function InboxSections({ active }: { active: "jobs" | "companies" }) {
  const { network } = useApp();
  const count =
    network.incoming.length +
    network.connections.reduce((sum, c) => sum + c.unread, 0);
  return (
    <nav className="inbox-sections" aria-label="Inbox sections">
      <Link
        to="/jobs/inbox"
        aria-current={active === "jobs" ? "page" : undefined}
      >
        <BriefcaseBusiness size={16} />
        Jobs
      </Link>
      <Link
        to="/inbox/companies"
        aria-current={active === "companies" ? "page" : undefined}
      >
        <Building2 size={16} />
        Companies
        {count > 0 && (
          <span aria-label={`${count} company messages and requests`}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </nav>
  );
}

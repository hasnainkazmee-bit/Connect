import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useApp } from "./context";

export function companyInboxPath(companyId: string) {
  return `/inbox/companies?${new URLSearchParams({ company: companyId })}`;
}

export function CompanyMessageLink({
  company: target,
  className,
  compact = false,
}: {
  company: { id: string; name: string; is_demo?: boolean };
  className: string;
  compact?: boolean;
}) {
  const { company, session, signIn } = useApp();
  if (
    company?.id === target.id ||
    (company && !!company.is_demo !== !!target.is_demo)
  )
    return null;
  const path = companyInboxPath(target.id);
  const content = (
    <>
      <MessageSquare size={16} aria-hidden="true" />
      {compact ? "Message" : "Message company"}
    </>
  );
  return session.user ? (
    <Link className={className} to={path} aria-label={`Message ${target.name}`}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      onClick={() => signIn(path)}
      aria-label={`Message ${target.name}`}
    >
      {content}
    </button>
  );
}

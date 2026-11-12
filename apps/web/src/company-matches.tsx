import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { Logo } from "./identity";
import type { Company } from "./types";

export function CompanyMatches({
  name,
  exceptId,
  onSelect,
}: {
  name: string;
  exceptId?: string;
  onSelect?: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    setCompanies([]);
    if (name.trim().length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api<{ companies: Company[] }>(
        "/directory/matches?q=" + encodeURIComponent(name),
        { signal: abort.signal },
      )
        .then((r) => {
          if (!abort.signal.aborted)
            setCompanies(r.companies.filter((c) => c.id !== exceptId));
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [name, exceptId]);
  if (!companies.length) return null;
  return (
    <section className="company-matches" aria-label="Existing company profiles">
      <strong>Your company may already be here</strong>
      <p>
        Choose your company to continue. Your existing information stays with
        the profile.
      </p>
      {companies.map((c) => (
        <Link
          key={c.id}
          to={
            (c.listing_status === "unclaimed" ? "/claim/" : "/") +
            (c.username || c.slug)
          }
          onClick={onSelect}
        >
          <Logo company={c} size="tiny" />
          <span>
            <b>{c.name}</b>
            <small>
              {c.listing_status === "unclaimed"
                ? "Claim this profile"
                : "Already managed · View profile"}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </Link>
      ))}
    </section>
  );
}

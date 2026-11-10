import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  MapPin,
  MessageCircle,
  Paperclip,
  Users,
  Zap,
  House,
  PenTool,
  Wrench,
  Truck,
} from "lucide-react";

const services = [
  {
    title: "Crews & extra hands",
    detail: "A few days of help. A whole installation team.",
    trade: "Crews",
    icon: Users,
  },
  {
    title: "Electrical & commissioning",
    detail: "From the first connection to the final test.",
    trade: "Electrical",
    icon: Zap,
  },
  {
    title: "Solar installation",
    detail: "Experienced teams for rooftops and ground-mounted systems.",
    trade: "Installation",
    icon: House,
  },
  {
    title: "Design & engineering",
    detail: "Plans, drawings, and the expertise behind them.",
    trade: "Design",
    icon: PenTool,
  },
  {
    title: "Service & maintenance",
    detail: "Troubleshoot, repair, and keep systems performing.",
    trade: "Service",
    icon: Wrench,
  },
  {
    title: "Equipment & supplies",
    detail: "Modules, components, and supplies for the work ahead.",
    trade: "Equipment",
    icon: Truck,
  },
];
const steps = [
  {
    title: "Tell us what you need.",
    detail:
      "Describe the work, add your plans or photos, and let companies know where and when you need them.",
  },
  {
    title: "Choose the right company.",
    detail:
      "Compare quotes, availability, and experience. Ask questions before you decide who to work with.",
  },
  {
    title: "Keep the work together.",
    detail:
      "Messages, files, and progress stay with the job. Review the finished work when it’s ready.",
  },
];

function WorkflowPreview({ step }: { step: number }) {
  return (
    <div className="landing-preview" id="hiring-preview" aria-live="polite">
      <div className="landing-preview-bar">
        <img src="/assets/connect-icon.png" width="22" height="22" alt="" />
        <span>
          {
            ["Your job post", "Quotes for your job", "Your work, in one place"][
              step
            ]
          }
        </span>
        <small>Example</small>
      </div>
      <div className="landing-preview-content" key={step}>
        <span className="landing-preview-eyebrow">CREWS & LABOR</span>
        <h3>Four-person installation crew for two weeks</h3>
        <p className="landing-preview-meta">
          <MapPin size={14} /> Dallas, TX <span>·</span> On site
        </p>
        {step === 0 && (
          <>
            <div className="landing-example-brief">
              <p>
                We’re looking for an experienced crew to help our team install a
                commercial rooftop system.
              </p>
              <dl>
                <div>
                  <dt>Start</dt>
                  <dd>Next month</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>2 weeks</dd>
                </div>
                <div>
                  <dt>People</dt>
                  <dd>4</dd>
                </div>
              </dl>
              <div className="landing-example-file">
                <FileText size={21} />
                <span>
                  Rooftop plans.pdf<small>Project attachment</small>
                </span>
                <Paperclip size={16} />
              </div>
            </div>
            <div className="landing-preview-bottom">
              <span>Ready for companies to quote</span>
              <Check size={17} />
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="landing-example-quotes">
              {[
                {
                  name: "Company A",
                  price: "$18,000",
                  start: "Available next month",
                },
                {
                  name: "Company B",
                  price: "$19,600",
                  start: "Flexible start date",
                },
              ].map((q) => (
                <div key={q.name}>
                  <div className="landing-example-company">
                    <span>{q.name.slice(-1)}</span>
                    <b>{q.name}</b>
                  </div>
                  <strong>
                    {q.price}
                    <small>Total quote</small>
                  </strong>
                  <p>
                    <Users size={14} /> Four-person crew
                  </p>
                  <p>{q.start}</p>
                </div>
              ))}
            </div>
            <div className="landing-preview-bottom">
              <MessageCircle size={17} />
              <span>Talk through the details before you choose.</span>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <ol className="landing-example-timeline">
              <li className="is-done">
                <span>
                  <Check size={14} />
                </span>
                <div>
                  <b>Company selected</b>
                  <small>Scope and quote agreed</small>
                </div>
              </li>
              <li className="is-current">
                <span />
                <div>
                  <b>Work in progress</b>
                  <small>Updates and photos shared with your team</small>
                </div>
              </li>
              <li>
                <span />
                <div>
                  <b>Review completed work</b>
                  <small>Check the result and confirm completion</small>
                </div>
              </li>
            </ol>
            <div className="landing-preview-bottom">
              <Paperclip size={17} />
              <span>The conversation stays with the job.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MarketplaceLanding() {
  const [step, setStep] = useState(0);
  return (
    <div className="market-landing landing-editorial">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-eyebrow">
          <span /> THE SOLAR WORK MARKETPLACE{" "}
          <span className="landing-sunhub">BY SUNHUB</span>
        </div>
        <h1 id="landing-title">
          Solar runs on <span>people.</span>
        </h1>
        <div className="landing-hero-intro">
          <p>
            A crew for next week. An electrician for tomorrow. A partner for the
            long run. Find the right company for the work ahead.
          </p>
          <div className="landing-actions">
            <Link to="/jobs/new" className="jobs-button jobs-primary">
              Post a job <ArrowUpRight size={18} />
            </Link>
            <Link to="/jobs" className="landing-text-link">
              Find work <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <figure className="landing-hero-photo">
          <picture>
            <source
              media="(max-width: 600px)"
              srcSet="/assets/marketplace/solar-crew-800.webp"
            />
            <img
              src="/assets/marketplace/solar-crew-1600.webp"
              width="1536"
              height="1024"
              alt="An overhead view of a crew working together on a commercial solar array"
              fetchPriority="high"
            />
          </picture>
          <figcaption>
            <span>From the first plan to the final panel.</span>
            <span>
              Built for the people who get it done.
              <ArrowUpRight size={17} />
            </span>
          </figcaption>
        </figure>
        <nav className="landing-trades" aria-label="Explore solar services">
          <span>FIND YOUR PEOPLE</span>
          {[
            "Crews",
            "Installation",
            "Electrical",
            "Design",
            "Service",
            "Logistics",
          ].map((trade) => (
            <Link key={trade} to={"/providers?trade=" + trade}>
              {trade}
              <ArrowUpRight size={13} />
            </Link>
          ))}
        </nav>
      </section>

      <section className="landing-expertise" aria-labelledby="expertise-title">
        <div className="landing-section-intro">
          <span className="landing-eyebrow">01 / THE RIGHT EXPERTISE</span>
          <h2 id="expertise-title">
            Whatever the job.
            <br /> Someone for it.
          </h2>
          <p>
            Solar work takes more than installers. Find the specialist, the
            extra hands, or the company your team is missing.
          </p>
          <Link to="/providers" className="landing-text-link">
            Explore all companies <ArrowRight size={17} />
          </Link>
        </div>
        <div className="landing-service-list">
          {services.map(({ title, detail, trade, icon: Icon }) => (
            <Link key={trade} to={"/providers?trade=" + trade}>
              <Icon size={23} strokeWidth={1.5} />
              <span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </span>
              <ArrowUpRight
                className="landing-service-arrow"
                size={21}
                strokeWidth={1.5}
              />
            </Link>
          ))}
        </div>
      </section>

      <section
        className="landing-how"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="landing-section-intro">
          <span className="landing-eyebrow">02 / FROM POSTED TO DONE</span>
          <h2 id="how-title">
            A clearer way
            <br /> to work together.
          </h2>
          <div
            className="landing-step-controls"
            aria-label="Explore the hiring process"
          >
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-pressed={step === i}
                aria-controls="hiring-preview"
                onClick={() => setStep(i)}
              >
                <span className="landing-step-number">0{i + 1}</span>
                <span>
                  <strong>{s.title}</strong>
                  <span>{s.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <WorkflowPreview step={step} />
      </section>

      <section className="landing-grow" aria-labelledby="grow-title">
        <div className="landing-grow-photo">
          <img
            src="/assets/marketplace/solar-planning-900.webp"
            width="1024"
            height="1280"
            alt="Hands studying a solar layout drawing at a workbench"
            loading="lazy"
          />
        </div>
        <div className="landing-grow-copy">
          <span className="landing-eyebrow">03 / FOR THE NEXT OPPORTUNITY</span>
          <h2 id="grow-title">
            You do good work.
            <br /> Let it find you
            <br /> more business.
          </h2>
          <p>
            Your experience deserves more than a name in a contact list. Bring
            your services, projects, and credentials together in a company
            profile.
          </p>
          <ul>
            <li>
              <Check size={17} /> Show the work you’re proud of.
            </li>
            <li>
              <Check size={17} /> Find jobs where your team can help.
            </li>
            <li>
              <Check size={17} /> Talk directly with the company hiring.
            </li>
          </ul>
          <Link to="/claim" className="jobs-button jobs-primary">
            Find & claim your company <ArrowUpRight size={18} />
          </Link>
          <Link to="/jobs" className="landing-text-link">
            Or explore available work <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="landing-faq" aria-labelledby="faq-title">
        <div className="landing-section-intro">
          <span className="landing-eyebrow">A FEW GOOD QUESTIONS</span>
          <h2 id="faq-title">
            Before you
            <br /> get started.
          </h2>
          <p>One company account. Both sides of the work.</p>
        </div>
        <div>
          {[
            [
              "What kind of work can I post?",
              "Anything your solar business needs help with: crews, installation, electrical work, repairs, design, permitting, inspections, equipment, or logistics. It can be a small task, ongoing support, or a larger project.",
            ],
            [
              "Can my company both hire and find work?",
              "Yes. Post jobs when you need help and send quotes when your team can take on work. Both are managed from the same company account.",
            ],
            [
              "What happens after I post?",
              "Companies can send private quotes with their price, availability, and approach. You can also invite companies to quote. Compare their proposals and talk through the details before choosing.",
            ],
            [
              "How do payments work?",
              "You agree on terms and pay the company directly. Connect keeps a record of payment stages and confirmations alongside the job; it does not hold or transfer funds.",
            ],
            [
              "Is my company already here?",
              "Search for your company and claim its profile to manage it. If it isn’t listed, you can create a company profile when you join Connect.",
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <ChevronDown size={18} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-top">
          <Link to="/" className="landing-footer-brand">
            <img src="/assets/connect-logo.png" alt="Connect" />
            <span>by Sunhub</span>
          </Link>
          <p>
            Built around the work.
            <br /> And the people behind it.
          </p>
          <nav aria-label="Footer">
            <Link to="/jobs/new">Post a job</Link>
            <Link to="/jobs">Find work</Link>
            <Link to="/providers">Find companies</Link>
            <Link to="/claim">Claim your company</Link>
          </nav>
        </div>
        <div className="landing-footer-bottom">
          <span>Connect. Talk. Build.</span>
          <span>A Sunhub product.</span>
        </div>
      </footer>
    </div>
  );
}

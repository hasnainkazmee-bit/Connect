import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { marketingView } from "./marketing-template";
import { iconMarkup, BrandIcon } from "./icons";
import { useApp } from "../context";
import { api } from "../api";
import { marketingCompanySnapshot } from "./marketing-companies";
import "./marketing-base.css";
import "./marketing-editorial.css";
import "./marketing-refinement.css";
import "./marketing-network.css";

const pages: Record<string,string>={home:"/",hire:"/hire",work:"/find-work",how:"/how-it-works",story:"/our-story",network:"/network"};
const photos:Record<string,string>={roof:"roof",detail:"detail",planning:"planning",craft:"craft"};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function MarketingHeader({signIn}:{signIn:()=>void}){
 const [menu,setMenu]=useState(false);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setMenu(false)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);
 const links=<>{[["/hire","Hire a company"],["/find-work","Find work"],["/providers","Companies"],["/network","Network"],["/how-it-works","How it works"]].map(([to,label])=><NavLink key={to} to={to} onClick={()=>setMenu(false)}>{label}</NavLink>)}</>;
 return <header className="mk-header"><div className="mk-header-inner"><Link className="mk-brand" to="/" aria-label="Colabb home"><img src="/brand/marks/lockup-nav.svg" alt="Colabb"/></Link><nav className="mk-nav" aria-label="Main navigation">{links}</nav><div className="mk-header-actions"><button className="mk-link" onClick={signIn}>Sign in</button><Link className="mk-btn mk-primary" to="/jobs/new"><BrandIcon name="post-job" size={17}/>Post a job</Link><button className="mk-menu-toggle" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-controls="colabb-mobile-menu" aria-label={menu?"Close navigation":"Open navigation"}><BrandIcon name={menu?"close":"menu"} size={22}/></button></div>{menu&&<nav className="mk-header-menu-mobile" id="colabb-mobile-menu" aria-label="Mobile navigation">{links}<Link to="/our-story" onClick={()=>setMenu(false)}>Our story</Link><Link className="mk-btn mk-primary" to="/jobs/new" onClick={()=>setMenu(false)}>Post a job</Link></nav>}</div></header>
}
export function ColabbFooter({compact=false}:{compact?:boolean}){
 return <footer className={compact?"colabb-footer-compact":"mk-footer"}><div className="mk-footer-inner"><div className="mk-footer-main"><div><Link className="mk-brand" to="/"><img src="/brand/marks/lockup-primary.svg" alt="Colabb"/></Link><p>The working network for solar.<br/>A Sunhub company.</p></div><nav aria-label="Get to work"><h3>Get to work</h3><Link to="/hire">Hire a company</Link><Link to="/find-work">Find work</Link><Link to="/providers">Explore companies</Link><Link to="/claim">Set up your company</Link></nav><nav aria-label="About Colabb"><h3>About Colabb</h3><Link to="/how-it-works">How it works</Link><Link to="/our-story">Our story</Link><Link to="/network">Network &amp; communities</Link><Link to="/how-it-works#mx-messaging-title">Company messaging</Link><Link to="/help/trust">Trust on Colabb</Link></nav><nav aria-label="Support"><h3>Help &amp; information</h3><Link to="/help">Help</Link><Link to="/help/privacy">Privacy</Link><Link to="/help/payments">Agreements & payments</Link><Link to="/help/accessibility">Accessibility</Link></nav></div><div className="mk-footer-bottom"><span>© {new Date().getFullYear()} Colabb · A Sunhub company</span><span>Good work. Great company.</span></div></div></footer>
}
export function ColabbMarketing({page="home"}:{page?:string}){
 const navigate=useNavigate();const location=useLocation();const app=useApp();const root=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<Record<string,unknown>>({marketingScope:"electrical"});
 const [publicCompanies,setPublicCompanies]=useState(marketingCompanySnapshot);
 useEffect(()=>{
  if(location.hash!=="#mx-messaging-title")return;
  const frame=requestAnimationFrame(()=>document.getElementById("mx-messaging-title")?.scrollIntoView({block:"start"}));
  return()=>cancelAnimationFrame(frame);
 },[page,location.hash]);
 useEffect(()=>{
  if(page!=="home")return;
  const controller=new AbortController();
  api<{providers:typeof marketingCompanySnapshot}>("/jobs/providers?sample=false",{signal:controller.signal})
   .then(({providers})=>setPublicCompanies(marketingCompanySnapshot.map(saved=>providers.find(company=>company.id===saved.id&&company.is_demo===false)||saved)))
   .catch(()=>{/* Keep the verified first-paint profiles if the directory is unavailable. */});
  return()=>controller.abort();
 },[page]);
 const html=marketingView({state:{...state,marketingPage:page},I:iconMarkup,photo:(key:string,alt:string)=>`<img src="/brand/${photos[key]||"roof"}.webp" alt="${escape(alt)}" loading="${key==="planning"?"eager":"lazy"}"/>`,companyLogo:(id:string)=>`<img src="/assets/demo-logos/demo-${id==="riverbend"?"riverbend-renewables-crew":"summit-grid-electric"}-mark.svg" alt=""/>`,publicCompanies});
 function action(event:React.MouseEvent<HTMLDivElement>){
  const el=(event.target as HTMLElement).closest<HTMLElement>("[data-action]");if(!el)return;
  const a=el.dataset.action!,v=el.dataset.value||"";
  const local:Record<string,string>={"marketing-scope":"marketingScope","marketing-ribbon":"marketingRibbon","marketing-chapter":"marketingChapter","marketing-need":"marketingNeed","marketing-stage":"marketingStage","marketing-network":"marketingNetwork"};
  if(local[a]){setState(s=>({...s,[local[a]]:a==="marketing-stage"?Number(v):v}));requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`[data-action="${a}"][data-value="${v}"]`)?.focus({preventScroll:true}));return;}
  if(a==="marketing-page")navigate(pages[v]||"/");
  else if(a==="marketing-companies")navigate("/providers");
  else if(a==="marketing-jobs")navigate("/jobs");
  else if(a==="marketing-need-companies"||a==="marketing-profile")navigate("/providers?trade="+encodeURIComponent(({electrical:"Electrical",crew:"Crews",testing:"Inspection",equipment:"Equipment",maintenance:"Service"} as Record<string,string>)[v]||"Electrical"));
  else if(a==="marketing-start")navigate(v==="post-job"?"/jobs/new":"/claim");
  else if(a==="marketing-signin")app.signIn(v||undefined);
  else if(a==="marketing-support")navigate("/help/"+v);
 }
 return <><div ref={root} className="colabb-marketing" onClick={action} dangerouslySetInnerHTML={{__html:html}}/><ColabbFooter/></>;
}

/** Render the approved marketing source for first paint and non-JavaScript visitors. */
import fs from 'node:fs/promises';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFile(new URL(p,root),'utf8');
const source=await read('apps/colabb/src/brand/marketing-template.ts');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {marketingView,marketingCSS}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const iconSource=await read('apps/colabb/src/brand/icons.tsx');
const icons=JSON.parse(iconSource.split(' = ',2)[1].split(';\n',1)[0]);
const I=(key,size=20)=>(icons[key]||icons['arrow-right']).replace(/width="24"/,'width="'+size+'"').replace(/height="24"/,'height="'+size+'"');
const companySource=await read('apps/colabb/src/brand/marketing-companies.ts');
const companyModule=ts.transpileModule(companySource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {marketingCompanySnapshot:publicCompanies}=await import('data:text/javascript;base64,'+Buffer.from(companyModule).toString('base64'));
const pages={home:'/',hire:'/hire',work:'/find-work',how:'/how-it-works',story:'/our-story'};
for(const page of Object.keys(pages)){
 let body=marketingView({state:{marketingPage:page},I,photo:(key,alt)=>`<img src="/brand/${key}.webp" alt="${alt}"/>`,companyLogo:id=>`<img src="/assets/demo-logos/demo-${id==='riverbend'?'riverbend-renewables-crew':'summit-grid-electric'}-mark.svg" alt=""/>`,publicCompanies});
 body=body.replace(/<button([^>]*data-action="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g,(all,attrs,action,label)=>{
 const value=attrs.match(/data-value="([^"]*)"/)?.[1]||'';
 const href=action==='marketing-page'?pages[value]:action==='marketing-start'?(value==='post-job'?'/jobs/new':'/claim'):action==='marketing-jobs'?'/jobs':action==='marketing-companies'||action==='marketing-need-companies'||action==='marketing-profile'?'/providers':null;
 return href?`<a${attrs} href="${href}">${label}</a>`:all;
 });
 const header=`<header class="mk-header"><div class="mk-header-inner"><a class="mk-brand" href="/"><img src="/brand/marks/lockup-primary.svg" alt="Colabb"/></a><nav class="mk-nav"><a href="/hire">Hire a company</a><a href="/find-work">Find work</a><a href="/providers">Companies</a><a href="/how-it-works">How it works</a></nav><div class="mk-header-actions"><a href="/account">Sign in</a><a class="mk-btn mk-primary" href="/jobs/new">Post a job</a></div></div></header>`;
 await fs.writeFile(new URL(`apps/colabb/dist/marketing-${page}.html`,root),`${header}<main class="app-main colabb-marketing">${body}</main>`);
}

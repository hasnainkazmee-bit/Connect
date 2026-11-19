/** Render the approved marketing source for first paint and non-JavaScript visitors. */
import fs from 'node:fs/promises';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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
// Server-render the same React cards used in Network, not a second HTML replica.
const previewBundle=await build({
 stdin:{contents:`import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {MemoryRouter} from 'react-router-dom'; import {NetworkMarketingPreview} from './apps/colabb/src/brand/network-preview.tsx'; export const renderNetworkPreview=kind=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(NetworkMarketingPreview,{kind})));`,resolveDir:fileURLToPath(root)},
 bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},
 external:['react','react/*','react-dom/*','react-router-dom','lucide-react'],
});
const previewModule={exports:{}};
new Function('require','module','exports',previewBundle.outputFiles[0].text)(createRequire(import.meta.url),previewModule,previewModule.exports);
const {renderNetworkPreview}=previewModule.exports;
const pages={home:'/',hire:'/hire',work:'/find-work',how:'/how-it-works',story:'/our-story',network:'/network'};
for(const page of Object.keys(pages)){
 let body=marketingView({state:{marketingPage:page},I,photo:(key,alt)=>`<img src="/brand/${key}.webp" alt="${alt}"/>`,renderNetworkPreview,companyLogo:id=>`<img src="/assets/demo-logos/demo-${id==='riverbend'?'riverbend-renewables-crew':'summit-grid-electric'}-mark.svg" alt=""/>`,publicCompanies});
 body=body.replace(/<button([^>]*data-action="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g,(all,attrs,action,label)=>{
 const value=attrs.match(/data-value="([^"]*)"/)?.[1]||'';
 const href=action==='marketing-page'?pages[value]:action==='marketing-start'?(value==='post-job'?'/jobs/new':'/claim'):action==='marketing-signin'?'/network/communities':action==='marketing-jobs'?'/jobs':action==='marketing-companies'||action==='marketing-need-companies'||action==='marketing-profile'?'/providers':null;
 return href?`<a${attrs} href="${href}">${label}</a>`:all;
 });
 const header=`<header class="mk-header"><div class="mk-header-inner"><a class="mk-brand" href="/" aria-label="Colabb home"><img src="/brand/marks/lockup-nav.svg" alt="Colabb" width="349.4285" height="52"/></a><nav class="mk-nav" aria-label="Main navigation"><a href="/hire">Hire a company</a><a href="/find-work">Find work</a><a href="/providers">Companies</a><a href="/network">Network</a><a href="/how-it-works">How it works</a></nav><div class="mk-header-actions"><a class="mk-link" href="/account">Sign in</a><a class="mk-btn mk-primary" href="/jobs/new"><span class="colabb-icon" aria-hidden="true">${I('post-job',17)}</span>Post a job</a></div></div></header>`;
 await fs.writeFile(new URL(`apps/colabb/dist/marketing-${page}.html`,root),`${header}<main class="app-main colabb-marketing">${body}</main><footer class="seo-footer"><a href="/services">Browse services and locations</a><a href="/help">Help</a><a href="/help/privacy">Privacy</a><a href="/our-story">A Sunhub company</a></footer>`);
}

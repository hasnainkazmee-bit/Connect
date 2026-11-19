import { Link, useParams } from "react-router-dom";
import { BrandIcon } from "./icons";

import { helpTopics as topics } from "../../../api/src/shared/help-content";

export function ColabbHelp(){const {topic="help"}=useParams();const data=topics[topic];if(!data)return <article className="colabb-help"><h1>Help page not found.</h1><Link to="/help">Browse help topics</Link></article>;return <article className="colabb-help"><Link className="job-back" to="/"><BrandIcon name="back" size={16}/>Back to Colabb</Link><p className="colabb-eyebrow">THE USEFUL DETAILS</p><h1>{data.title}</h1><p className="colabb-help-intro">{data.intro}</p><div className="colabb-help-layout"><nav aria-label="Help topics">{Object.entries(topics).map(([k,v])=><Link key={k} to={k==="help"?"/help":"/help/"+k} aria-current={k===topic?"page":undefined}>{k==="help"?"Getting started":k==="payments"?"Agreements & payments":k.charAt(0).toUpperCase()+k.slice(1)}</Link>)}</nav><div>{data.sections.map(([title,body])=><section key={title}><h2>{title}</h2><p>{body}</p></section>)}</div></div></article>}

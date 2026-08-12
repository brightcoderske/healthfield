import { Activity } from "lucide-react";
import { backendJson } from "@/lib/backend-api";

type Entry={id:number;actorId:number|null;action:string;entityType:string;entityId:string|null;metadata:unknown;createdAt:string;actor:{firstName:string;lastName:string;email:string}|null};
export const dynamic="force-dynamic";

function detail(value:unknown){
  if(!value||typeof value!=="object")return "—";
  return Object.entries(value as Record<string,unknown>).slice(0,4).map(([key,item])=>`${key}: ${typeof item==="object"?JSON.stringify(item):String(item)}`).join(" · ");
}

export default async function ActivityPage(){
  const {activities}=await backendJson<{activities:Entry[]}>("/v1/views/admin/activity");
  return <main className="compact-admin-page"><header><div><a href="/admin">← Dashboard</a><h1>System activity</h1><p>Who performed each sensitive operation, when it happened and which record changed.</p></div></header>{activities.length?<div className="compact-table"><div className="compact-table-head activity-log-row"><span>When</span><span>Actor</span><span>Action</span><span>Record</span><span>Details</span></div>{activities.map((entry)=><div className="compact-table-row activity-log-row" key={entry.id}><span>{new Date(entry.createdAt).toLocaleString("en-KE")}</span><span><strong>{entry.actor?`${entry.actor.firstName} ${entry.actor.lastName}`:"System"}</strong><small>{entry.actor?.email||"Automated event"}</small></span><strong>{entry.action.replaceAll("_"," ")}</strong><span>{entry.entityType}{entry.entityId?` #${entry.entityId}`:""}</span><small title={detail(entry.metadata)}>{detail(entry.metadata)}</small></div>)}</div>:<div className="database-empty"><Activity/><strong>No activity yet</strong><span>Tracked operational changes will appear here.</span></div>}</main>;
}

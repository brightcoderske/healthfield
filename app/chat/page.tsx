import { redirect } from "next/navigation";
import { getSession, requireRole } from "@/lib/auth";
import { ChatPanel } from "./chat-panel";
export const dynamic="force-dynamic";

export default async function ChatPage(){
  // Someone who is not signed in is asked to sign in and then brought straight back to
  // the chat. A plain login redirect used to drop them on their account page instead, so
  // the conversation they came for was lost at the moment they signed in.
  if(!(await getSession())) redirect("/login?next=/chat");
  await requireRole(["CUSTOMER"]);
  return <ChatPanel/>;
}

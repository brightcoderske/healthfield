import { requireRole } from "@/lib/auth";
import { ChatPanel } from "./chat-panel";
export const dynamic="force-dynamic";
export default async function ChatPage(){await requireRole(["CUSTOMER"]);return <ChatPanel/>}

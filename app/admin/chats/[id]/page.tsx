import { ChatPanel } from "@/app/chat/chat-panel";
export default async function AdminChatPage({params}:{params:Promise<{id:string}>}){return <ChatPanel conversationId={Number((await params).id)}/>}

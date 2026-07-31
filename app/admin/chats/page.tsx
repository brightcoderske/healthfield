import { desc,eq } from "drizzle-orm";
import { MessageCircle } from "lucide-react";
import { getDb } from "@/db";
import { chatConversations,users } from "@/db/schema";
import { SearchableTable } from "../searchable-table";
export const dynamic="force-dynamic";
export default async function ChatsPage(){const rows=await getDb().select({id:chatConversations.id,status:chatConversations.status,lastMessageAt:chatConversations.lastMessageAt,firstName:users.firstName,lastName:users.lastName,email:users.email}).from(chatConversations).innerJoin(users,eq(users.id,chatConversations.customerId)).orderBy(desc(chatConversations.lastMessageAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Customer chats</h1><p>Help shoppers while purchase intent is high.</p></header><SearchableTable columns={["Customer","Status","Last activity","Action"]} placeholder="Search customer, email or chat status" rows={rows.map(row=>({id:row.id,cells:[{primary:`${row.firstName} ${row.lastName}`,secondary:row.email,href:`/admin/chats/${row.id}`},{primary:row.status},{primary:row.lastMessageAt.toLocaleString()},{primary:"Open chat",href:`/admin/chats/${row.id}`}]}))} empty={<><MessageCircle/><strong>No chats yet</strong><span>Customer conversations appear here.</span></>}/></main>}

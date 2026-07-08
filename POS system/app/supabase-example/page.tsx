import { createClient } from "@/utils/supabase/server";

export default async function SupabaseExamplePage() {
  const supabase = await createClient();
  const { data: todos } = await supabase.from("todos").select();

  return (
    <ul>
      {todos?.map((todo: { id: string; name: string }) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  );
}

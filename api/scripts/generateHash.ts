import bcrypt from "bcrypt";

async function run() {
  const hash = await bcrypt.hash("1234", 10);
  console.log(hash);
}

run();
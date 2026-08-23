import DashboardClient from "./dashboard-client";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const data = await getDashboardData();
  return <DashboardClient {...data}/>;
}

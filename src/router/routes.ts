import { Sparkles } from "lucide-vue-next";

export interface RouteConfig {
  path: string;
  name: string;
  component: () => Promise<any>;
  title: string;
  icon: any;
}

// Конфигурация маршрутов для простой версии приложения:
// только Feed и Events, без секций и авторизации
export const routesConfig: RouteConfig[] = [
  {
    path: "/main",
    name: "main",
    component: () => import("../pages/main.vue"),
    title: "Bus",
    icon: Sparkles,
  },
];

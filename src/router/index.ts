import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { routesConfig } from "./routes";

// Преобразуем конфигурацию маршрутов в формат Vue Router и добавляем редирект с главной на Events
const routes: RouteRecordRaw[] = routesConfig.map((route) => ({
  path: route.path,
  name: route.name,
  component: route.component,
}));

routes.push({
  path: "/",
  redirect: "/main",
});

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;

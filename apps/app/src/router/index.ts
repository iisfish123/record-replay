import { createRouter, createWebHashHistory } from 'vue-router';
import LoginPage from '@/pages/login/index.vue';
import HomePage from '@/pages/home/index.vue';
import PersonaPage from '@/pages/persona/index.vue';
import ChatPage from '@/pages/chat/index.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/home', name: 'home', component: HomePage },
    { path: '/persona', name: 'persona-create', component: PersonaPage },
    { path: '/persona/:id', name: 'persona-edit', component: PersonaPage },
    { path: '/chat', name: 'chat', component: ChatPage },
  ],
});

/** 全局守卫：未登录跳登录页；已登录访问登录页跳管理页。token 由 App.vue 启动时恢复。 */
router.beforeEach((to) => {
  const token = localStorage.getItem('token');
  if (!token && to.name !== 'login') {
    return { name: 'login' };
  }
  if (token && to.name === 'login') {
    return { name: 'home' };
  }
});

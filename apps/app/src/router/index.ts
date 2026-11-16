import { createRouter, createWebHashHistory } from 'vue-router';
import LoginPage from '@/pages/login/index.vue';
import HomePage from '@/pages/home/index.vue';
import ChatPage from '@/pages/chat/index.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/home', name: 'home', component: HomePage },
    { path: '/chat', name: 'chat', component: ChatPage },
  ],
});

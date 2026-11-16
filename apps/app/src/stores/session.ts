import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSessionStore = defineStore('session', () => {
  const personaId = ref<string>((uni.getStorageSync('personaId') as string) || '');
  const taskId = ref<string>('');

  function setPersona(id: string): void {
    personaId.value = id;
    uni.setStorageSync('personaId', id);
  }

  function setTask(id: string): void {
    taskId.value = id;
  }

  function reset(): void {
    personaId.value = '';
    taskId.value = '';
    uni.removeStorageSync('personaId');
  }

  return { personaId, taskId, setPersona, setTask, reset };
});

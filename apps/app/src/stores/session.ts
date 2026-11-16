import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSessionStore = defineStore('session', () => {
  const personaId = ref<string>(localStorage.getItem('personaId') || '');
  const taskId = ref<string>('');

  function setPersona(id: string): void {
    personaId.value = id;
    localStorage.setItem('personaId', id);
  }

  function setTask(id: string): void {
    taskId.value = id;
  }

  function reset(): void {
    personaId.value = '';
    taskId.value = '';
    localStorage.removeItem('personaId');
  }

  return { personaId, taskId, setPersona, setTask, reset };
});

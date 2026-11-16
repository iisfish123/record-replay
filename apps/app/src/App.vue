<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { setAuthToken } from '@/api/request';

onLaunch(() => {
  const token = uni.getStorageSync('token') as string;
  if (token) setAuthToken(token);
});
</script>

<style>
page {
  background-color: #f6f6f8;
}
</style>

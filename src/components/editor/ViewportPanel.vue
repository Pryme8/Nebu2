<template>
  <!--
    ViewportPanel — Wraps BabylonViewport so the 3D render scene lives
    inside the panel system and can be dragged / resized like any other panel.
  -->
  <div class="w-full h-full overflow-hidden">
    <BabylonViewport class="w-full h-full" />
  </div>
</template>

<script setup lang="ts">
import BabylonViewport from './BabylonViewport.vue'
</script>

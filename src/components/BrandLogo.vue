<script setup lang="ts">
import mark from '../../src-tauri/icons/source.svg'
</script>
<template>
  <div class="brand-lockup"><img :src="mark" class="brand-symbol" width="38" height="38" alt=""><div><div class="brand-name">insto<span class="brand-osint">OSINT</span></div><div class="brand-caption">INSTAGRAM INTELLIGENCE</div></div></div>
</template>
<style scoped>
.brand-lockup{display:flex;align-items:center;gap:12px}.brand-symbol{width:38px;height:38px;filter:drop-shadow(0 0 12px #cd48a322);flex-shrink:0}.brand-name{display:flex;align-items:center;gap:10px;font-size:24px;letter-spacing:-.9px;font-weight:650;line-height:1.1;color:#f2edf4}.brand-osint{font:8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.7px;border:1px solid #81416e;border-radius:4px;padding:4px 5px;color:#eb9ec9}.brand-caption{font:8px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.45px;color:#9c859e;margin-top:5px}@media(max-width:560px){.brand-symbol{width:33px;height:33px}.brand-name{font-size:22px}.brand-caption{font-size:7px;letter-spacing:1px}}
</style>

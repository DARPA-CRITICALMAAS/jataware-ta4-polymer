import Alpine from 'alpinejs';
import persist from '@alpinejs/persist';
import morph from '@alpinejs/morph';

window.Alpine = Alpine;
Alpine.plugin(persist);
Alpine.plugin(morph);
Alpine.start();

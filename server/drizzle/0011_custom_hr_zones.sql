-- 支持自定义五区间绝对心率数值与计算模式
ALTER TABLE `users` ADD `hr_calc_mode` text DEFAULT 'auto';
ALTER TABLE `users` ADD `custom_hr_zones` text;

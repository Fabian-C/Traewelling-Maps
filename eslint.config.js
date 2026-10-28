import globals from 'globals';

export default [
    {
        files: ['js/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            // mapboxgl / turf / deck are loaded from CDN <script> tags (see index.html)
            globals: { ...globals.browser, ...globals.node, mapboxgl: 'readonly', turf: 'readonly', deck: 'readonly' }
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-var': 'error',
            'prefer-const': 'warn',
            eqeqeq: ['warn', 'smart']
        }
    }
];

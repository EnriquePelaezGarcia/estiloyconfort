# Especificación de Reglas de Precios - Mueblería Estilo y Confort

## 1. Parámetros de Configuración

### Variables Globales
Todas las variables de configuración se almacenan en la hoja "Configuración" y se referencian como `Configuración!$B$X`:

| Parámetro | Valor | Referencia |
|-----------|-------|-----------|
| IVA (%) | 16% | Configuración!$B$4 |
| Comisión Tarjeta Base (%) | 2.79% | Configuración!$B$5 |
| Comisión Tarjeta Neta (%) | 3.2364% | Configuración!$B$6 |
| Comisión MSI Base (%) | 7.69% | Configuración!$B$7 |
| Comisión MSI Neta (%) | 8.9204% | Configuración!$B$8 |
| Tasa Interés Crédito Tienda (%) | 22% | Configuración!$B$9 |
| % Pago Inicial Crédito | 35% | Configuración!$B$10 |
| # Semanas Financiamiento | 12 | Configuración!$B$11 |

---

## 2. Estructura de Columnas en Calculadora de Precios

| Columna | Nombre | Descripción |
|---------|--------|-------------|
| A | Modelo | Identificador del producto (no visible en pantalla) |
| B | Producto | Nombre del producto |
| C | Costo Prov. | Costo del proveedor (entrada manual) |
| D | % Ganancia | Margen de ganancia deseado (entrada manual) |
| E | Prov. + Gan. S/IVA | Precio base sin IVA (cálculo) |
| F | Monto Ganancia | Monto absoluto de ganancia |
| G | % IVA | Tasa de IVA aplicada |
| H | Monto IVA | Monto de IVA |
| I | Prov. + Gan. C/IVA | Precio con IVA (antes de comisiones) |
| J | % Com. Tarjeta | Comisión de tarjeta |
| K | Monto Com. Tarjeta | Monto absoluto de comisión tarjeta |
| L | Precio Mayoreo | Precio mayorista (markup 33.4% del costo) |
| M | Precio Contado | Precio contado con absorción de comisión tarjeta |
| N | % Com. MSI | Comisión MSI (6 meses sin intereses) |
| O | Monto Com. MSI | Monto absoluto de comisión MSI |
| P | Precio a 6 MSI | Precio con absorción de comisión MSI |
| Q | Interés Crédito | Interés sobre precio contado |
| R | Precio a Crédito | Precio con interés y tasa al contado |
| S | Pago Inicial | Primer pago (35% del precio a crédito) |
| T | 12 Pagos Semanales | Cuota semanal por 12 semanas |
| U | Util. Efectivo | Ganancia al contado puro |
| V | Util. Ctdo. Tarjeta | Ganancia neta (contado - comisión tarjeta) |
| W | Util. MSI | Ganancia neta (MSI - comisión MSI) |
| X | Util. Crédito | Ganancia neta (crédito - IVA) |
| Y | Util. Mayoreo | Ganancia mayorista |

---

## 3. Flujo de Cálculos por Producto

### Paso 1: Margen de Ganancia (Precio Base Sin IVA)
```
Fórmula: E = C / (1 - D)
Descripción: Calcula el precio base que incluye el margen deseado
Ejemplo: Si costo es $1,350 y margen es 29.3%
  E = 1,350 / (1 - 0.293) = $1,908.71
```

### Paso 2: Ganancia Absoluta
```
Fórmula: F = E - C
Descripción: Monto en pesos de la ganancia bruta
Ejemplo: $1,908.71 - $1,350 = $558.71
```

### Paso 3: Aplicación de IVA
```
Fórmula G: = Configuración!$B$4 (siempre 16%)
Fórmula H: = E * Configuración!$B$4
Descripción: Calcula el IVA sobre el precio sin IVA
Ejemplo: $1,908.71 × 0.16 = $305.39
```

### Paso 4: Precio con IVA (Base para Comisiones)
```
Fórmula: I = E + H
Descripción: Precio que será la base para calcular comisiones
Ejemplo: $1,908.71 + $305.39 = $2,214.10
```

### Paso 5: Comisiones
```
Fórmulas:
  J = Configuración!$B$6 (Comisión tarjeta neta: 3.2364%)
  K = M * Configuración!$B$6
  N = Configuración!$B$8 (Comisión MSI neta: 8.9204%)
  O = P * Configuración!$B$8

Descripción: Las comisiones se calculan sobre los precios finales M y P
```

---

## 4. Cálculo de Precios de Venta

### 4.1 Precio Mayoreo (L)
```
Fórmula: L = CEILING(C * 1.334, 1)
Descripción: Markup sobre el costo
  - Multiplica el costo por 1.334 (33.4% adicional)
  - Redondea hacia arriba al peso más cercano (CEILING)
Ejemplo: $1,350 × 1.334 = $1,800.90 → $1,801
```

### 4.2 Precio Contado (M) - ABSORCIÓN DE COMISIÓN TARJETA
```
Fórmula: M = CEILING(I / (1 - Configuración!$B$6), 10)
Descripción: Absorbe la comisión de tarjeta en el precio
  - Divide el precio con IVA (I) entre (1 - comisión tarjeta)
  - Redondea hacia arriba a la decena más cercana
  
Lógica matemática:
  Si M es el precio final y la comisión es 3.2364%
  La tienda retiene: M - (M × 0.032364) = I
  Despejando: M = I / (1 - 0.032364) = I / 0.967636
  
Ejemplo: $2,214.10 / 0.967636 = $2,288.20 → $2,290
```

### 4.3 Precio a 6 MSI (P) - ABSORCIÓN DE COMISIÓN MSI
```
Fórmula: P = CEILING(I / (1 - Configuración!$B$6 - Configuración!$B$8), 10)
Descripción: Absorbe tanto comisión tarjeta como MSI
  - Resta ambas comisiones del denominador
  - Redondea hacia arriba a la decena más cercana
  
Lógica: M = I / (1 - 0.032364 - 0.089204) = I / 0.878432
Ejemplo: $2,214.10 / 0.878432 = $2,520.49 → $2,520
```

### 4.4 Precio a Crédito (R)
```
Paso 1 - Interés: Q = M * Configuración!$B$9
  Q = M × 0.22 (22% de interés anual)
  
Paso 2 - Precio Total: R = CEILING(M + Q, 10)
  Suma el precio contado más los intereses
  Redondea hacia arriba a la decena
  
Ejemplo:
  M = $2,290
  Q = $2,290 × 0.22 = $503.80
  R = CEILING($2,290 + $503.80, 10) = $2,800
```

---

## 5. Plan de Financiamiento (Crédito en Tienda)

### Pago Inicial (S)
```
Fórmula: S = CEILING(R * Configuración!$B$10, 1)
Descripción: 35% del precio a crédito como primer pago
Ejemplo: $2,800 × 0.35 = $980
```

### Cuotas Semanales (T)
```
Fórmula: T = CEILING((R - S) / Configuración!$B$11, 1)
Descripción: 
  - Divide el saldo (R - S) entre 12 semanas
  - Redondea hacia arriba al peso más cercano
  
Ejemplo:
  Saldo = $2,800 - $980 = $1,820
  T = CEILING($1,820 / 12, 1) = CEILING($151.67, 1) = $152
  
Estructura de pagos:
  - Pago inicial: $980
  - 12 pagos semanales de: $152 cada uno
  - Total: $980 + (12 × $152) = $2,804
```

---

## 6. Cálculo de Utilidades (Ganancias Netas)

### 6.1 Utilidad Efectivo (U)
```
Fórmula: U = M - C
Descripción: Ganancia si se vende al contado (sin considerar comisiones)
Ejemplo: $2,290 - $1,350 = $940
```

### 6.2 Utilidad Contado Tarjeta (V)
```
Fórmula: V = M - C - H - K
Descripción: Ganancia después de restar:
  - Costo (C)
  - IVA pagado (H)
  - Comisión tarjeta (K)
  
Nota: Se deduce el IVA porque es obligación fiscal
Ejemplo: $2,290 - $1,350 - $305.39 - $74.24 = $560.37
```

### 6.3 Utilidad MSI (W)
```
Fórmula: W = P - C - H - K - O
Descripción: Ganancia con plan MSI después de restar:
  - Costo (C)
  - IVA (H)
  - Comisión tarjeta (K)
  - Comisión MSI (O)
  
Ejemplo: Asumiendo P=$2,520, O=$225
  $2,520 - $1,350 - $305.39 - $74.24 - $225 = $565.37
```

### 6.4 Utilidad Crédito (X)
```
Fórmula: X = R - C - H
Descripción: Ganancia en crédito después de restar:
  - Costo (C)
  - IVA (H)
  
Nota: No se deduce comisión (es venta directa)
Ejemplo: $2,800 - $1,350 - $305.39 = $1,144.61
```

### 6.5 Utilidad Mayoreo (Y)
```
Fórmula: Y = L - C
Descripción: Ganancia simple al precio mayoreo
Ejemplo: $1,801 - $1,350 = $451
```

---

## 7. Casos Especiales

### Productos con Mayoreo Reducido (Filas 59-100)
Algunos productos usan una fórmula diferente para Precio Mayoreo:
```
Fórmula L: = C * 1.15
Descripción: Markup de solo 15% en lugar de 33.4%
Redondeo: Sin especificar función CEILING en estas filas
Ejemplo: Si C = $5,000
  L = $5,000 × 1.15 = $5,750
```

### Producto Especial: Cama Completa (Fila 43)
```
Fórmula de Costo Compuesto:
C43 = SUM(C42+C49, C39)
     = Base + Colchón + Par de Buros

Descripción: Este producto es un conjunto que suma tres artículos
El resto de cálculos procesan normalmente
```

---

## 8. Redondeos Aplicados

| Operación | Función | Descripción |
|-----------|---------|-------------|
| Mayoreo | CEILING(x, 1) | Redondea al peso superior |
| Contado/MSI | CEILING(x, 10) | Redondea a la decena superior |
| Pago Inicial | CEILING(x, 1) | Redondea al peso superior |
| Cuotas | CEILING(x, 1) | Redondea al peso superior |

---

## 9. Flujo Completo de Ejemplo: Espejo Vanity

**Datos de Entrada:**
- Costo: $1,350
- Margen deseado: 29.3%

**Cálculos:**

| Paso | Fórmula | Cálculo | Resultado |
|------|---------|---------|-----------|
| 1 | E = C / (1 - D) | 1,350 / 0.707 | $1,908.71 |
| 2 | F = E - C | 1,908.71 - 1,350 | $558.71 |
| 3 | H = E × 0.16 | 1,908.71 × 0.16 | $305.39 |
| 4 | I = E + H | 1,908.71 + 305.39 | $2,214.10 |
| 5 | L = C × 1.334 | 1,350 × 1.334 | $1,801 |
| 6 | M = I / 0.967636 | 2,214.10 / 0.967636 | $2,290 |
| 7 | P = I / 0.878432 | 2,214.10 / 0.878432 | $2,520 |
| 8 | Q = M × 0.22 | 2,290 × 0.22 | $503.80 |
| 9 | R = M + Q | 2,290 + 503.80 | $2,800 |
| 10 | S = R × 0.35 | 2,800 × 0.35 | $980 |
| 11 | T = (R-S) / 12 | (2,800-980) / 12 | $152 |

**Precios Finales:**
- Mayoreo: $1,801
- Contado: $2,290
- MSI 6 meses: $2,520
- Crédito (cuotas): Inicial $980 + 12 cuotas de $152

---

## 10. Notas Importantes

1. **Absorción de Comisiones**: Los precios M y P ya incluyen la absorción de comisiones de Mercado Pago. El cliente paga estos precios y la tienda retiene menos la comisión.

2. **IVA**: Se aplica sobre el precio base sin ganancia, pero se incluye en el precio de venta, incrementando la utilidad neta.

3. **Comisiones MSI**: La fórmula de P absorbe tanto comisión tarjeta como MSI porque se entiende que MSI es un plan de tarjeta con estas características.

4. **Redondeos Estratégicos**: Los redondeos a decenas en precios altos facilitan pagos más limpios y favorecen al cliente mientras se mantiene margen.

5. **Crédito en Tienda**: Es la opción con mayor ganancia neta ($1,144.61 vs $560.37 contado) porque incluye el 22% de interés anual.

6. **Cobertura ISR**: Aunque se menciona RESICO ISR 2.5%, no se refleja explícitamente en estas fórmulas, presumiblemente se deduce de ganancias posteriores.

---

## 11. Referencias Cruzadas de Hojas

- **Configuración**: Almacena todos los parámetros globales
- **Calculadora de Precios**: Contiene todas las fórmulas y se calcula para cada producto
- **Lista de Precios**: Extrae columnas M, P, R, S, T (precios finales para cliente)
- **Precios Mayoreo**: Extrae columnas L, M (mayoreo y contado) para mayoristas


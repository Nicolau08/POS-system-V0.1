# Verticais & Capabilities

## Objetivo

POSly mantém `commerce_type` por compatibilidade, mas passa a suportar:

- `vertical`: perfil funcional principal do comércio
- `capabilities_json`: lista JSON de capacidades activas na licença/runtime

Se uma licença antiga não tiver `vertical` ou `capabilities_json`, o sistema faz fallback a partir de `commerce_type`.

## Campos

- `commerce_type`: compatibilidade com licenças legadas (`restauracao`, `retalho`, `farmacia`)
- `vertical`: perfil principal actual
- `capabilities_json`: array JSON com flags de módulos e comportamento

Exemplo:

```json
["sales","inventory","customers","multi_station","tables","print_centers","kds"]
```

## Catálogo

### Core

- `sales`
- `inventory`
- `customers`
- `multi_station`
- `android_posto`

### Restauração

- `tables`
- `print_centers`
- `kds`
- `android_kds`

### Serviços

- `services`
- `staff_commission`
- `appointments`
- `memberships`
- `checkin`

### Saúde & Regulado

- `batches_expiry`
- `controlled_items`

### Especializado

- `weighing`
- `departments`
- `work_orders`
- `quotes`

## Presets por vertical

| Vertical | Capabilities por defeito |
|----------|--------------------------|
| `restauracao` | `sales`, `inventory`, `customers`, `multi_station`, `tables`, `print_centers`, `kds` |
| `retalho` | `sales`, `inventory`, `customers`, `multi_station` |
| `farmacia` | `sales`, `inventory`, `customers`, `multi_station`, `batches_expiry`, `controlled_items` |
| `barbearia` | `sales`, `customers`, `services`, `staff_commission`, `appointments` |
| `salao_beleza` | `sales`, `customers`, `services`, `staff_commission`, `appointments` |
| `ginasio` | `sales`, `customers`, `services`, `appointments`, `memberships`, `checkin` |
| `talho` | `sales`, `inventory`, `customers`, `multi_station`, `batches_expiry`, `weighing` |
| `supermercado` | `sales`, `inventory`, `customers`, `multi_station`, `departments` |
| `graficas` | `sales`, `inventory`, `customers`, `services`, `work_orders`, `quotes` |
| `hotelaria` | `sales`, `inventory`, `customers`, `multi_station`, `tables` |

## Regras de fallback

1. Se `vertical` estiver vazio, inferir a partir de `commerce_type`.
2. Se `capabilities_json` estiver vazio, usar o preset da `vertical`.
3. `commerce_type` não é removido e continua no payload `/tenant/info`.

## Compatibilidade

- `restauracao`, `retalho` e `farmacia` existentes mantêm o comportamento actual.
- Gating de mesas deve depender de `tables`.
- Gating de centros de impressão/KDS deve depender de `print_centers`.
- `android-posto` pode ler `vertical` e `capabilities` de `/tenant/info`, mas continua compatível se esses campos não vierem.

# ☁️ Maestría en Cloud Computing — Semana 2

Repositorio de ejercicios prácticos de la **Semana 2** de la Maestría en Cloud Computing.  
Todos los proyectos están construidos con **AWS CDK (TypeScript)** y despliegan infraestructura serverless y de cómputo sobre AWS.

---

## 📁 Estructura del Repositorio

```
MaestriaCloudeComputingSemana2/
├── Ejercicio1/   → Lambda con CDK
├── Ejercicio2/   → API REST + DynamoDB
├── Ejercicio3/   → S3, CloudFront & Files API
├── Ejercicio4/   → VPC, Load Balancers & Réplicas EC2
└── .gitignore
```

---

## 🧪 Ejercicio 1 — Lambda con CDK

**Proyecto:** `tarea-lambda-cdk`

Despliegue de una función **AWS Lambda** simple utilizando AWS CDK.

| Recurso | Detalle |
|---------|---------|
| Lambda Runtime | Node.js 20.x |
| Handler | Inline (código embebido en el stack) |
| Funcionalidad | Recibe un evento con un `name` y retorna `"Hello {name}!!"` |

**Servicios AWS utilizados:** Lambda, CloudFormation

### Despliegue

```bash
cd Ejercicio1/tarea-lambda-cdk
npm install
npx cdk deploy
```

---

## 🎬 Ejercicio 2 — Netflix API REST + DynamoDB

**Proyecto:** `netflix-api-db`

API REST completa para gestionar un catálogo de películas estilo Netflix, con operaciones CRUD expuestas a través de API Gateway y persistencia en DynamoDB.

| Recurso | Detalle |
|---------|---------|
| API Gateway | REST API con stage `prod` |
| Lambdas | 5 funciones (List, Get, Create, Update, Delete) |
| DynamoDB | Tabla `peliculas` con GSIs por género, director y año |
| Endpoints | `GET/POST /api/v1/movies` · `GET/PUT/DELETE /api/v1/movies/{id}` |

**Servicios AWS utilizados:** API Gateway, Lambda, DynamoDB, CloudFormation

### Despliegue

```bash
cd Ejercicio2/netflix-api-db
npm install
npx cdk deploy
```

---

## 🪣 Ejercicio 3 — S3, CloudFront & Files API

**Proyecto:** `netflix-bucket2` + `netflix-bucket3`

Dos stacks complementarios que conforman la capa de almacenamiento y entrega de contenido:

### 3a · `netflix-bucket2` — Sitio web estático con CloudFront

| Recurso | Detalle |
|---------|---------|
| S3 Bucket | Hosting de sitio web estático (acceso bloqueado, via OAC) |
| CloudFront | Distribución CDN con HTTPS y redirección de errores |
| Configuración dinámica | `config.js` inyectado con la URL del API Gateway |

### 3b · `netflix-bucket3` — API de archivos con S3 + DynamoDB

| Recurso | Detalle |
|---------|---------|
| S3 Bucket | Almacén de archivos con CORS habilitado |
| DynamoDB | Tabla `archivos` con GSI por tipo de contenido |
| API Gateway | REST API con soporte de binarios (`*/*`) |
| Lambdas | 4 funciones (Upload, List, Get, Delete) |
| Endpoints | `GET/POST /api/v1/files` · `GET/DELETE /api/v1/files/{id}` |

**Servicios AWS utilizados:** S3, CloudFront, API Gateway, Lambda, DynamoDB, CloudFormation

### Despliegue

```bash
# Stack del sitio web
cd Ejercicio3/netflix-bucket2
npm install
npx cdk deploy

# Stack del API de archivos
cd ../netflix-bucket3
npm install
npx cdk deploy
```

---

## 🌐 Ejercicio 4 — VPC, Load Balancers & Réplicas EC2

**Proyecto:** `netflix-vpc-load-balancer-replicas`

Infraestructura de alta disponibilidad para desplegar **OpenEDX** con 3 réplicas EC2 distribuidas en 3 Availability Zones, balanceo de carga multinivel y base de datos administrada.

| Recurso | Detalle |
|---------|---------|
| VPC | CIDR `10.1.0.0/16`, 3 AZs, subnets públicas y privadas, 1 NAT Gateway |
| EC2 | 3 instancias Ubuntu 22.04 LTS (`t3.medium`), una por AZ |
| NLB | Network Load Balancer público (internet-facing) |
| ALB | Application Load Balancer interno con health checks y round-robin |
| RDS | PostgreSQL 15 (`t3.micro`) en subnet privada |
| Secrets Manager | Credenciales de Aurora generadas automáticamente |
| IAM | Rol EC2 con SSM + CloudWatch |

### Arquitectura

```
Internet → NLB (público) → ALB (interno) → 3x EC2 Ubuntu (OpenEDX)
                                                    ↓
                                           RDS PostgreSQL 15
```

**Servicios AWS utilizados:** VPC, EC2, NLB, ALB, RDS, Secrets Manager, IAM, CloudFormation

### Despliegue

```bash
cd Ejercicio4/netflix-vpc-load-balancer-replicas
npm install
npx cdk deploy
```

---

## ⚙️ Requisitos Previos

- [Node.js](https://nodejs.org/) ≥ 18.x
- [AWS CLI](https://aws.amazon.com/cli/) configurado con credenciales válidas
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) ≥ 2.x

```bash
npm install -g aws-cdk
cdk bootstrap   # Solo la primera vez por cuenta/región
```

---

## 👤 Autor

**Edward Salinas**  
Maestría en Cloud Computing

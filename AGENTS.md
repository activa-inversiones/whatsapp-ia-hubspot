# Reglas de revisión — Oliver, el bot de WhatsApp (temp-wa)

Reglas para quien REVISA un cambio en este repo. Cada una nació de un defecto real o de una
instrucción del dueño; el detalle vive en `temp-sales-os/_activa-docs/ERRORES-Y-GANANCIAS-ACTIVA.md`
y en `CLAUDE.md`. No son preferencias de estilo.

## Lo que este repo es

Oliver atiende a clientes reales por WhatsApp y **cotiza**. Un error acá no ensucia un tablero:
le cobra de menos a un cliente, le promete algo que la empresa no hace, o deja una conversación
sin respuesta. Es el código que toca plata y reputación al mismo tiempo.

## Entrega de mensajes

- **HTTP 200 NO prueba entrega.** Fuera de la ventana de servicio de 24 h de Meta, el texto libre
  se acepta con 200 —incluso devolviendo un id— y Meta lo marca `failed` (131047) después, por
  webhook. Marcar algo como enviado por `r.ok` deja al destinatario sin mensaje **y sin reintento**.
  Medido el 05-sep: un registro decía "enviado" con cero mensajes llegados en dos días.
- **Fuera de la ventana va PLANTILLA APROBADA, y si la plantilla falla NO se cae a texto libre**:
  el 200 del texto sería exactamente el falso positivo que originó la regla.
- Un envío confirmado se registra con **cómo** se entregó (canal, id del mensaje), no solo con que
  se entregó: sin eso no se puede auditar después contra los webhooks.

## Precio y cotización

- **El único pricer válido es ACTIVA Engine** (`PRICER_MODE = "engine"`, hardcodeado, marcado
  `// NO TOCA`). El bot pega a `ops.activalabs.ai/api/quotes/calculate`, **NUNCA** a `api.winart.cl`
  para el precio. Cualquier cambio que reintroduzca otro pricer es un NO APTO automático: el motor
  que se eliminó daba $40.032.547 donde el bueno da $904.077 para la misma ventana.
- **Anti-alucinación: si falta un dato, se pide o se marca — nunca se rellena en silencio.** Un PDF
  o una cotización formal solo se emiten con datos confirmados.
- **NO inventar datos de negocio.** Precios, medidas, materiales, plazos y qué vende la empresa
  vienen del dueño o del sistema. Inferirlos desde los datos ya costó tres correcciones.
- **Hay líneas que NO cotiza el bot: aluminio, muros cortina y la línea ANDES (monorriel = 1 hoja
  móvil + 1 paño fijo).** Esas las cotiza el dueño en persona. Una corredera de 3 hojas con la
  central fija **sí** se cotiza sola (son 2 hojas móviles, doble riel).

## Clasificación de lo que dice el cliente

- **La decisión del tipo de ventana se toma en una capa ARRIBA** de los detectores finos: un fix en
  el detector de correderas no corre nunca si el clasificador de aperturas ya resolvió antes. Al
  revisar, seguir el camino completo, no la función que cambió.
- **`conversations.last_message_preview` NO sirve para contar ni clasificar**: guarda solo el
  último mensaje y truncado. Contar sobre él dio 12 donde eran 184.

## Identificadores de plataformas ajenas

- **El largo o el formato de un ID de Meta no es contrato nuestro.** Validarlo por forma estricta
  rompe el canal el día que Meta lo cambia.
- **Una validación que falla ABIERTA es peor que no tenerla:** si la consulta vuelve vacía, el
  default es denegar, no permitir. Ya pasó: un teléfono de 8 dígitos no encontraba su conversación
  y la guardia respondía "permitido".
- Nunca confiar en un identificador que manda el cliente para decidir quién es o qué puede hacer.

## Agenda y seguimiento

- **Un cliente perdido no se agenda** (regla del dueño, 19-ago). Si un cambio vuelve a meterlos en
  una lista de trabajo, es una decisión que hay que declarar, no un detalle de implementación.
- Un mensaje automático de seguimiento que no se entregó **no cuenta como contactado**.

## Tests

- **Un test que lee el archivo fuente y busca un texto no prueba conducta.** Probar el comportamiento.
- **Un test tiene que ponerse ROJO con el defecto puesto.** Si test e implementación entran juntos,
  decirlo explícitamente.
- **Dar vuelta una aserción es una decisión**: queda escrito en el test por qué y de quién salió.
- La suite de este repo corre sin red y sin BD. No romper esa garantía.

## Producción

- `main` es la rama que despliega. **Un `git push` es producción**: antes, mirar el rango completo
  de commits que se sube y avisar si aparece trabajo ajeno.
- Respetar los comentarios `// NO TOCA:`.

## Secretos

- Usar un secreto está bien; **imprimirlo al chat o a un log, nunca**. Comprobar existencia, no
  valor. Prohibido volcar las variables de entorno de un servicio sin filtrar.
